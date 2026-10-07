// bech32 and bech32m (BIP 173 / BIP 350) without the 90-character limit, which BOLT11 invoices exceed.
// Data is handled as "words": 5-bit values, one per character.

import { MAX_INVOICE_LENGTH } from './input.js';

export const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const CHECKSUM_CONSTANTS = { bech32: 1, bech32m: 0x2bc830a3 };
const CHECKSUM_WORDS = 6;

function polymod(values) {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    GENERATOR.forEach((g, i) => {
      if ((top >>> i) & 1) checksum ^= g;
    });
  }
  return checksum >>> 0;
}

function expandHrp(hrp) {
  const codes = Array.from(hrp, (c) => c.charCodeAt(0));
  return [...codes.map((c) => c >> 5), 0, ...codes.map((c) => c & 31)];
}

/**
 * Splits a bech32 string into human-readable part and data words (without checksum).
 * `encoding` is 'bech32', 'bech32m' or null if the checksum is wrong.
 * `label` names the input in error messages ("The invoice mixes …").
 * @returns {{ hrp: string, words: number[], encoding: 'bech32'|'bech32m'|null }}
 */
export function bech32Decode(text, label = 'text') {
  if (typeof text !== 'string' || text.length > MAX_INVOICE_LENGTH)
    throw new Error(`The ${label} is too long or is not text.`);
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) {
    throw new Error(`The ${label} mixes upper- and lower-case letters.`);
  }
  text = text.toLowerCase();
  const separator = text.lastIndexOf('1');
  if (separator < 1 || separator + 1 + CHECKSUM_WORDS > text.length) {
    throw new Error(`This does not look like a valid ${label} (the “1” separator is missing).`);
  }
  const hrp = text.slice(0, separator);
  if (hrp.length > 83) throw new Error(`The ${label} prefix is too long.`);
  if (/[^\x21-\x7e]/.test(hrp)) throw new Error(`Invalid character in the ${label} prefix.`);

  const words = [];
  for (let i = separator + 1; i < text.length; i++) {
    const word = CHARSET.indexOf(text[i]);
    if (word === -1) throw new Error(`Invalid character in the ${label} at position ${i + 1}.`);
    words.push(word);
  }

  const checksum = polymod([...expandHrp(hrp), ...words]);
  const encoding =
    Object.keys(CHECKSUM_CONSTANTS).find((name) => CHECKSUM_CONSTANTS[name] === checksum) ?? null;
  return { hrp, words: words.slice(0, -CHECKSUM_WORDS), encoding };
}

export function bech32Encode(hrp, words, encoding = 'bech32') {
  const checksum =
    polymod([...expandHrp(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ CHECKSUM_CONSTANTS[encoding];
  const checksumWords = Array.from(
    { length: CHECKSUM_WORDS },
    (_, i) => (checksum >>> (5 * (5 - i))) & 31,
  );
  return hrp + '1' + [...words, ...checksumWords].map((word) => CHARSET[word]).join('');
}

/** Regroups bits: 8-bit bytes → 5-bit words (the last word is zero-padded). */
export function bytesToWords(bytes) {
  return regroupBits(bytes, 8, 5, true);
}

/** Regroups bits: 5-bit words → bytes. Leftover bits are dropped unless `pad` is set (then zero-padded). */
export function wordsToBytes(words, { pad = false, strict = false } = {}) {
  const remaining = (words.length * 5) % 8;
  if (strict && (remaining >= 5 || (remaining && words.at(-1) & ((1 << remaining) - 1)))) {
    throw new Error('Invalid field padding.');
  }
  return Uint8Array.from(regroupBits(words, 5, 8, pad));
}

/** Big-endian integer from 5-bit words. */
export function wordsToInt(words) {
  return words.reduce((value, word) => {
    const next = value * 32 + word;
    if (!Number.isSafeInteger(next)) throw new Error('Invoice integer is out of range.');
    return next;
  }, 0);
}

function regroupBits(values, fromBits, toBits, pad) {
  const mask = (1 << toBits) - 1;
  const result = [];
  let accumulator = 0;
  let bits = 0;
  for (const value of values) {
    accumulator = ((accumulator << fromBits) | value) & 0xfff;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((accumulator >> bits) & mask);
    }
  }
  if (pad && bits > 0) result.push((accumulator << (toBits - bits)) & mask);
  return result;
}
