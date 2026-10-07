// Byte, hex and integer conversions shared by the verification code.

export function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error('Invalid hex string');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return bytes;
}

export function concatBytes(...parts) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function bytesToBigInt(bytes) {
  return bytes.length ? BigInt('0x' + bytesToHex(bytes)) : 0n;
}

export function bigIntToBytes(value, length) {
  const hex = value.toString(16).padStart(length * 2, '0');
  if (hex.length > length * 2) throw new Error('Number too large');
  return hexToBytes(hex);
}

/** Unsigned big-endian integer of up to 6 bytes. */
export function readUintBE(bytes, offset, length) {
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + bytes[offset + i];
  return value;
}
