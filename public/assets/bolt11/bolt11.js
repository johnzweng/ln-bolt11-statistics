// BOLT #11 statistics decoder, adapted from ln-payment-proof (MIT).
// No signature verification: use the stated node key, or recover it when absent.
// Spec: https://github.com/lightning/bolts/blob/master/11-payment-encoding.md

import { CHARSET, bech32Decode, wordsToBytes, wordsToInt } from './bech32.js';
import { bytesToHex, concatBytes, hexToBytes, readUintBE } from './bytes.js';
import { knownNode } from './known-nodes.js';
import { decodePublicKey, ecdsaRecover } from './secp256k1.js';
import { sha256 } from './sha256.js';
import { MAX_DATE_SECONDS, MAX_FIELDS, MAX_ROUTE_HOPS, normalizeInvoice } from './input.js';
import {
  SPARK_FALLBACK_VERSION,
  SPARK_SCID_SENTINEL,
  decodeSparkAddress,
  encodeSparkAddress,
  findSparkWallet,
} from './spark.js';

export { normalizeInvoice } from './input.js';

const TIMESTAMP_WORDS = 7;
const SIGNATURE_WORDS = 104; // 520 bits: 64-byte signature (r ‖ s) + 1-byte recovery id
const TAG_HEADER_WORDS = 3; // 1 word tag + 2 words data length
const HASH_WORDS = 52; // 32 bytes
const PUBKEY_WORDS = 53; // 33 bytes
const ROUTE_HOP_BYTES = 51; // node id 33 + short channel id 8 + base fee 4 + proportional fee 4 + CLTV delta 2

const DEFAULT_EXPIRY_SECONDS = 3600;
const DEFAULT_MIN_FINAL_CLTV = 18;

const NETWORK_NAMES = {
  bc: 'Bitcoin mainnet',
  tb: 'Bitcoin testnet',
  tbs: 'Bitcoin signet',
  bcrt: 'Bitcoin regtest',
  sb: 'Simnet',
};

// Longer codes first, so that "lnbcrt…" is not read as "lnbc" + "rt…".
const PREFIX_PATTERN = /^ln(bcrt|tbs|bc|tb|sb)([0-9]*[munp]?)$/;

// 1 BTC = 10^11 millisatoshis
const MSAT_PER_UNIT = { '': 100_000_000_000n, m: 100_000_000n, u: 100_000n, n: 100n };

const FIELD_NAMES = {
  p: 'Payment hash',
  s: 'Payment secret',
  d: 'Description',
  m: 'Payment metadata',
  n: 'Receiver node id',
  h: 'Description hash',
  x: 'Expiry',
  c: 'Min. final CLTV expiry delta',
  f: 'On-chain fallback address',
  r: 'Route hint',
  9: 'Features',
};

// Fields with a fixed length. The spec says to skip them if the length is different.
const FIXED_LENGTH_FIELDS = {
  p: { key: 'paymentHash', words: HASH_WORDS },
  s: { key: 'paymentSecret', words: HASH_WORDS },
  h: { key: 'descriptionHash', words: HASH_WORDS },
  n: { key: 'payeeNodeKey', words: PUBKEY_WORDS },
};

// Feature names by their even ("required") bit; the odd bit above it means "optional".
const FEATURE_NAMES = {
  0: 'option_data_loss_protect',
  8: 'var_onion_optin',
  14: 'payment_secret',
  16: 'basic_mpp',
  18: 'option_support_large_channel',
  24: 'option_route_blinding',
  48: 'option_payment_metadata',
  148: 'option_trampoline',
  50: 'option_zeroconf',
};

/** Decode an invoice for analysis. Checks checksum/framing, not payment validity. */
export function decodeInvoice(input) {
  const text = normalizeInvoice(input);
  if (!text) throw new Error('Please paste a Lightning invoice.');
  if (!/^ln/i.test(text))
    throw new Error('A Lightning invoice starts with “lnbc…” (or “lntb…” on testnet).');

  const { hrp, words, encoding } = bech32Decode(text, 'invoice');
  if (encoding !== 'bech32') {
    throw new Error(
      'The invoice checksum is wrong — it was probably not copied completely or contains a typo.',
    );
  }
  const { network, amountMsat } = parsePrefix(hrp);
  if (words.length < TIMESTAMP_WORDS + SIGNATURE_WORDS)
    throw new Error('The invoice is too short.');

  const body = words.slice(0, -SIGNATURE_WORDS);
  const timestamp = wordsToInt(body.slice(0, TIMESTAMP_WORDS));
  const invoice = {
    bolt11: text.toLowerCase(),
    hrp,
    network,
    networkName: NETWORK_NAMES[network],
    isMainnet: network === 'bc',
    amountMsat, // BigInt, or null for "any amount"
    timestamp, // seconds since 1970
    expirySeconds: DEFAULT_EXPIRY_SECONDS,
    minFinalCltv: DEFAULT_MIN_FINAL_CLTV,
    paymentHash: null,
    paymentSecret: null,
    description: null,
    descriptionHash: null,
    metadata: null,
    payeeNodeKey: null, // node id stated in the invoice (n field), if any
    fallbacks: [],
    routeHints: [], // [[hop, …], …]
    features: null,
    fields: [], // every tagged field, for display
  };

  for (const { tag, data } of readTaggedFields(body.slice(TIMESTAMP_WORDS))) {
    if (invoice.fields.length >= MAX_FIELDS) throw new Error('Invoice has too many fields.');
    invoice.fields.push(applyField(invoice, tag, data));
  }
  if (!invoice.paymentHash) throw new Error('The invoice has no payment hash.');

  invoice.expiresAt = timestamp + invoice.expirySeconds;
  if (!Number.isSafeInteger(invoice.expiresAt) || invoice.expiresAt > MAX_DATE_SECONDS) {
    throw new Error('Invoice expiry is out of range.');
  }
  invoice.spark = findSparkWallet(invoice);
  invoice.signature = extractIdentity(
    hrp,
    body,
    words.slice(-SIGNATURE_WORDS),
    invoice.payeeNodeKey,
  );
  invoice.nodeId = invoice.signature.nodeId;
  return invoice;
}

/** "lnbc2500u" → network "bc", amount 2500 µBTC in msat. */
function parsePrefix(hrp) {
  const match = PREFIX_PATTERN.exec(hrp);
  if (!match) throw new Error('Unknown invoice prefix.');
  return { network: match[1], amountMsat: parseAmount(match[2]) };
}

function parseAmount(amount) {
  if (!amount) return null;
  const match = /^(0|[1-9][0-9]*)([munp]?)$/.exec(amount);
  if (!match) throw new Error('Invalid amount in invoice.');
  const [, digits, multiplier] = match;
  const value = BigInt(digits);
  if (multiplier !== 'p') return value * MSAT_PER_UNIT[multiplier];
  // pico-BTC: 10 pBTC = 1 msat
  if (value % 10n !== 0n) throw new Error('Invalid pico-BTC amount (not a whole millisatoshi).');
  return value / 10n;
}

function* readTaggedFields(words) {
  let position = 0;
  while (position < words.length) {
    if (position + TAG_HEADER_WORDS > words.length) throw new Error('Invoice data is truncated.');
    const tag = CHARSET[words[position]];
    const length = words[position + 1] * 32 + words[position + 2];
    const start = position + TAG_HEADER_WORDS;
    const data = words.slice(start, start + length);
    if (data.length !== length) throw new Error(`Invoice field “${tag}” is truncated.`);
    yield { tag, data };
    position = start + length;
  }
}

/** Stores a tagged field's value on the invoice and returns a display entry for it. */
function applyField(invoice, tag, data) {
  const field = {
    tag,
    name: FIELD_NAMES[tag] ?? `Unknown field “${tag}”`,
    length: data.length,
    used: true,
    value: null,
  };
  const bytes = wordsToBytes(data);

  const fixed = FIXED_LENGTH_FIELDS[tag];
  if (fixed) {
    if (data.length === fixed.words && invoice[fixed.key] === null) {
      invoice[fixed.key] = field.value = bytesToHex(wordsToBytes(data, { strict: true }));
    } else {
      field.used = false;
    }
    return field;
  }

  switch (tag) {
    case 'd':
      invoice.description = field.value = new TextDecoder('utf-8', { fatal: true }).decode(
        wordsToBytes(data, { strict: true }),
      );
      break;
    case 'm':
      invoice.metadata = field.value = bytesToHex(bytes);
      break;
    case 'x':
      invoice.expirySeconds = wordsToInt(data);
      field.value = `${invoice.expirySeconds} seconds`;
      break;
    case 'c':
      invoice.minFinalCltv = wordsToInt(data);
      field.value = `${invoice.minFinalCltv} blocks`;
      break;
    case 'f': {
      const fallback = parseFallback(data);
      invoice.fallbacks.push(fallback);
      if (fallback.sparkText != null) {
        field.name = 'Spark address (fallback field, version 31)';
        field.value = fallback.sparkText;
      } else {
        field.value = `version ${fallback.version}: ${fallback.hex}`;
      }
      break;
    }
    case 'r': {
      if (bytes.length % ROUTE_HOP_BYTES !== 0) throw new Error('Invoice route hint is truncated.');
      wordsToBytes(data, { strict: true });
      const hopCount = bytes.length / ROUTE_HOP_BYTES;
      const previousHops = invoice.routeHints.reduce((count, hops) => count + hops.length, 0);
      if (previousHops + hopCount > MAX_ROUTE_HOPS)
        throw new Error('Invoice has too many route hops.');
      const hops = parseRouteHint(bytes, invoice.network);
      if (hops.length) invoice.routeHints.push(hops);
      const isSparkMarker = hops.some((hop) => hop.sparkIdentity);
      field.value =
        `${hops.length} hop${hops.length === 1 ? '' : 's'}` +
        (isSparkMarker ? ' (not a real route: Spark identity marker)' : '');
      break;
    }
    case '9':
      invoice.features = parseFeatures(data);
      field.value = invoice.features
        .map((f) => f.name + (f.required ? ' (required)' : ''))
        .join(', ');
      break;
    default:
      field.value = bytesToHex(bytes);
  }
  return field;
}

function parseFallback(data) {
  const version = data[0];
  const bytes = wordsToBytes(data.slice(1));
  const fallback = { version, hex: bytesToHex(bytes) };
  if (version === SPARK_FALLBACK_VERSION) {
    fallback.sparkText = new TextDecoder().decode(bytes);
    fallback.spark = decodeSparkAddress(fallback.sparkText);
  }
  return fallback;
}

function parseRouteHint(bytes, network) {
  const hops = [];
  for (let offset = 0; offset + ROUTE_HOP_BYTES <= bytes.length; offset += ROUTE_HOP_BYTES) {
    const keyBytes = bytes.subarray(offset, offset + 33);
    if (!decodePublicKey(keyBytes)) throw new Error('Invalid public key in route hint.');
    const pubkey = bytesToHex(keyBytes);
    const shortChannelId = parseShortChannelId(bytes.subarray(offset + 33, offset + 41));
    const sparkIdentity = shortChannelId.hex === SPARK_SCID_SENTINEL;
    hops.push({
      pubkey,
      shortChannelId,
      feeBaseMsat: readUintBE(bytes, offset + 41, 4),
      feeProportionalMillionths: readUintBE(bytes, offset + 45, 4),
      cltvExpiryDelta: readUintBE(bytes, offset + 49, 2),
      knownAs: knownNode(network, pubkey),
      sparkIdentity, // true: not a real hop, the "node id" is a Spark wallet's identity key
      sparkAddress: sparkIdentity ? encodeSparkAddress(pubkey, network) : null,
    });
  }
  return hops;
}

/** Short channel id: funding transaction position as block height × transaction index × output index. */
function parseShortChannelId(bytes) {
  const block = readUintBE(bytes, 0, 3);
  const tx = readUintBE(bytes, 3, 3);
  const output = readUintBE(bytes, 6, 2);
  return { block, tx, output, text: `${block}x${tx}x${output}`, hex: bytesToHex(bytes) };
}

/** Feature bits form a big-endian bit field; bit 0 is the last bit of the last word. */
function parseFeatures(data) {
  const totalBits = data.length * 5;
  const features = [];
  data.forEach((word, wordIndex) => {
    for (let i = 0; i < 5; i++) {
      if (!((word >> (4 - i)) & 1)) continue;
      const bit = totalBits - 1 - (wordIndex * 5 + i);
      const evenBit = bit - (bit % 2);
      features.push({
        bit,
        name: FEATURE_NAMES[evenBit] ?? `bit ${bit}`,
        required: bit === evenBit,
      });
    }
  });
  return features.sort((a, b) => a.bit - b.bit);
}

/**
 * The signature covers SHA-256(hrp as ASCII ‖ data words before the signature, as zero-padded bytes).
 * If the invoice states no node id, the node id is recovered from the signature (as the spec requires).
 */
function extractIdentity(hrp, bodyWords, signatureWords, statedNodeId) {
  const signatureBytes = wordsToBytes(signatureWords, { strict: true });
  const recoveryId = signatureBytes[64];
  if (recoveryId > 3) throw new Error('Invalid invoice recovery id.');
  if (statedNodeId !== null) {
    if (!decodePublicKey(hexToBytes(statedNodeId))) throw new Error('Invalid receiver public key.');
    return { nodeId: statedNodeId, nodeIdInInvoice: true, recoveryId };
  }
  const message = concatBytes(
    new TextEncoder().encode(hrp),
    wordsToBytes(bodyWords, { pad: true }),
  );
  const recovered = ecdsaRecover(sha256(message), signatureBytes.subarray(0, 64), recoveryId);
  if (!recovered) throw new Error('Could not recover receiver public key.');
  return { nodeId: bytesToHex(recovered), nodeIdInInvoice: false, recoveryId };
}
