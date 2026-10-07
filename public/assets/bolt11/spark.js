// Spark (a Bitcoin layer 2): wallets embed their Spark identity in the Lightning invoices they issue.
//
// Detection and address format follow the Spark SDK (github.com/buildonspark/spark,
// sdks/js/packages/spark-sdk/src/services/bolt11-spark.ts and src/utils/address.ts):
//   1. a fallback-address field (f) with version 31, whose data is a Spark address as text, or
//   2. (legacy) a fake route hint with the sentinel short_channel_id f42400f424000001,
//      whose "node id" is the wallet's Spark identity key.
// A Spark address is bech32m(hrp, protobuf SparkAddress { 1: identity_public_key, 2: invoice fields, 3: signature }).

import { bech32Decode, bech32Encode, bytesToWords, wordsToBytes } from './bech32.js';
import { bytesToHex, concatBytes, hexToBytes } from './bytes.js';
import { decodePublicKey } from './secp256k1.js';

export const SPARK_SCID_SENTINEL = 'f42400f424000001';
export const SPARK_FALLBACK_VERSION = 31;

const HRP_BY_INVOICE_NETWORK = {
  bc: 'spark',
  tb: 'sparkt',
  bcrt: 'sparkrt',
  tbs: 'sparks',
  sb: 'sparks',
};
const NETWORK_BY_HRP = {
  spark: 'mainnet',
  sparkt: 'testnet',
  sparkrt: 'regtest',
  sparks: 'signet',
  sparkl: 'local',
  sp: 'mainnet (legacy)',
  spt: 'testnet (legacy)',
  sprt: 'regtest (legacy)',
  sps: 'signet (legacy)',
  spl: 'local (legacy)',
};

const PROTOBUF_IDENTITY_KEY_TAG = 0x0a; // field 1, wire type 2 (length-delimited)

/** @param {string} network  invoice network code ('bc', 'tb', …) */
export function encodeSparkAddress(identityPublicKeyHex, network) {
  const key = hexToBytes(identityPublicKeyHex);
  if (key.length !== 33) throw new Error('A Spark identity key has 33 bytes.');
  const payload = concatBytes(Uint8Array.of(PROTOBUF_IDENTITY_KEY_TAG, key.length), key);
  return bech32Encode(HRP_BY_INVOICE_NETWORK[network] ?? 'spark', bytesToWords(payload), 'bech32m');
}

/** Decodes a Spark address (spark1…, or legacy sp1…). Returns null if it is not a valid one. */
export function decodeSparkAddress(text) {
  try {
    const address = String(text).trim();
    const { hrp, words, encoding } = bech32Decode(address);
    if (encoding !== 'bech32m' || !NETWORK_BY_HRP[hrp]) return null;

    const result = {
      address: address.toLowerCase(),
      hrp,
      network: NETWORK_BY_HRP[hrp],
      identityPublicKey: null,
      hasInvoiceFields: false,
      hasSignature: false,
    };
    for (const { field, value } of readProtobufFields(wordsToBytes(words))) {
      if (field === 1) result.identityPublicKey = bytesToHex(value);
      if (field === 2) result.hasInvoiceFields = true;
      if (field === 3) result.hasSignature = true;
    }
    const key = result.identityPublicKey;
    return key && key.length === 66 && decodePublicKey(hexToBytes(key)) ? result : null;
  } catch {
    return null;
  }
}

/**
 * Finds the Spark wallet of a decoded invoice, in the same order as the Spark SDK:
 * fallback field first, then the legacy route hint. Returns null for non-Spark invoices.
 */
export function findSparkWallet({ fallbacks, routeHints, network: invoiceNetwork }) {
  const fromFallback = fallbacks.find((fallback) => fallback.spark)?.spark;
  if (fromFallback) {
    const { identityPublicKey, address, network, hasInvoiceFields } = fromFallback;
    return { source: 'fallback', identityPublicKey, address, network, hasInvoiceFields };
  }
  for (const [routeIndex, hops] of routeHints.entries()) {
    const hop = hops.find((candidate) => candidate.sparkIdentity);
    if (hop) {
      const network = NETWORK_BY_HRP[HRP_BY_INVOICE_NETWORK[invoiceNetwork]];
      return {
        source: 'routehint',
        routeIndex,
        identityPublicKey: hop.pubkey,
        address: hop.sparkAddress,
        network,
      };
    }
  }
  return null;
}

/** Minimal protobuf reader: yields { field, value } for varint (number) and length-delimited (bytes) fields. */
function* readProtobufFields(bytes) {
  let position = 0;
  const readVarint = () => {
    let value = 0;
    for (let shift = 0; ; shift += 7) {
      if (position >= bytes.length || shift > 28) throw new Error('Invalid protobuf varint');
      const byte = bytes[position++];
      value += (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) return value;
    }
  };

  while (position < bytes.length) {
    const key = readVarint();
    const field = Math.floor(key / 8);
    const wireType = key % 8;
    if (wireType === 0) {
      yield { field, value: readVarint() };
    } else if (wireType === 2) {
      const length = readVarint();
      if (position + length > bytes.length) throw new Error('Truncated protobuf field');
      yield { field, value: bytes.subarray(position, position + length) };
      position += length;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wireType}`);
    }
  }
}
