// secp256k1 ECDSA: signature verification and public-key recovery (the curve of Bitcoin and Lightning).
// Only public data is processed (no private keys, no signing), so constant-time arithmetic is not needed.

import { bigIntToBytes, bytesToBigInt, concatBytes } from './bytes.js';

const P = 2n ** 256n - 2n ** 32n - 977n; // field prime
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n; // group order
const G = toJacobian({
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
});

/** DER prefix of a SubjectPublicKeyInfo for a compressed secp256k1 key (id-ecPublicKey + secp256k1 OIDs). */
export const SPKI_PREFIX_HEX = '3036301006072a8648ce3d020106052b8104000a032200';

/* ---------- modular arithmetic ---------- */

const mod = (a, m) => ((a % m) + m) % m;

function powMod(base, exponent, m) {
  let result = 1n;
  base = mod(base, m);
  for (; exponent > 0n; exponent >>= 1n) {
    if (exponent & 1n) result = (result * base) % m;
    base = (base * base) % m;
  }
  return result;
}

/** Modular inverse via Fermat's little theorem (m is prime). */
const invMod = (a, m) => powMod(a, m - 2n, m);

/* ---------- curve points ----------
 * Arithmetic uses Jacobian coordinates [X, Y, Z] (affine x = X/Z², y = Y/Z³) to avoid
 * an inversion per step. Z = 0 is the point at infinity. */

const INFINITY = [0n, 1n, 0n];

function toJacobian({ x, y }) {
  return [x, y, 1n];
}

function toAffine([x, y, z]) {
  if (z === 0n) return null;
  const zInv = invMod(z, P);
  const zInv2 = (zInv * zInv) % P;
  return { x: (x * zInv2) % P, y: (y * zInv2 * zInv) % P };
}

function double([x, y, z]) {
  if (z === 0n || y === 0n) return INFINITY;
  const yy = (y * y) % P;
  const s = (4n * x * yy) % P;
  const m = (3n * x * x) % P;
  const x3 = mod(m * m - 2n * s, P);
  const y3 = mod(m * (s - x3) - 8n * yy * yy, P);
  return [x3, y3, (2n * y * z) % P];
}

function add(p1, p2) {
  if (p1[2] === 0n) return p2;
  if (p2[2] === 0n) return p1;
  const [x1, y1, z1] = p1;
  const [x2, y2, z2] = p2;
  const z1z1 = (z1 * z1) % P;
  const z2z2 = (z2 * z2) % P;
  const u1 = (x1 * z2z2) % P;
  const u2 = (x2 * z1z1) % P;
  const s1 = (y1 * z2 * z2z2) % P;
  const s2 = (y2 * z1 * z1z1) % P;
  if (u1 === u2) return s1 === s2 ? double(p1) : INFINITY;
  const h = mod(u2 - u1, P);
  const r = mod(s2 - s1, P);
  const hh = (h * h) % P;
  const hhh = (h * hh) % P;
  const v = (u1 * hh) % P;
  const x3 = mod(r * r - hhh - 2n * v, P);
  const y3 = mod(r * (v - x3) - s1 * hhh, P);
  return [x3, y3, (z1 * z2 * h) % P];
}

function multiply(point, scalar) {
  let result = INFINITY;
  for (let k = mod(scalar, N); k > 0n; k >>= 1n) {
    if (k & 1n) result = add(result, point);
    point = double(point);
  }
  return result;
}

/** The curve point with this x coordinate and y parity (y² = x³ + 7), or null. */
function liftX(x, yIsOdd) {
  if (x >= P) return null;
  const ySquared = mod(x ** 3n + 7n, P);
  let y = powMod(ySquared, (P + 1n) / 4n, P); // square root, because P ≡ 3 (mod 4)
  if ((y * y) % P !== ySquared) return null;
  if ((y & 1n) !== (yIsOdd ? 1n : 0n)) y = P - y;
  return { x, y };
}

/* ---------- public keys ---------- */

/** Parses a 33-byte compressed or 65-byte uncompressed public key. Returns null if invalid. */
export function decodePublicKey(bytes) {
  if (bytes.length === 33 && (bytes[0] === 2 || bytes[0] === 3)) {
    return liftX(bytesToBigInt(bytes.subarray(1)), bytes[0] === 3);
  }
  if (bytes.length === 65 && bytes[0] === 4) {
    const x = bytesToBigInt(bytes.subarray(1, 33));
    const y = bytesToBigInt(bytes.subarray(33));
    return x < P && y < P && mod(y * y - x ** 3n - 7n, P) === 0n ? { x, y } : null;
  }
  return null;
}

function compressPublicKey({ x, y }) {
  return concatBytes(Uint8Array.of(y & 1n ? 3 : 2), bigIntToBytes(x, 32));
}

/* ---------- ECDSA ---------- */

/** Splits a 64-byte compact signature (r ‖ s). Returns null if r or s is out of range. */
function parseSignature(signature) {
  if (signature.length !== 64) return null;
  const r = bytesToBigInt(signature.subarray(0, 32));
  const s = bytesToBigInt(signature.subarray(32, 64));
  const inRange = (v) => v > 0n && v < N;
  return inRange(r) && inRange(s) ? { r, s } : null;
}

/**
 * @param {Uint8Array} hash       32-byte message hash
 * @param {Uint8Array} signature  64-byte compact signature (r ‖ s)
 * @param {Uint8Array} publicKey  33- or 65-byte public key
 */
export function ecdsaVerify(hash, signature, publicKey) {
  const q = decodePublicKey(publicKey);
  const sig = parseSignature(signature);
  if (!q || !sig) return false;
  const e = mod(bytesToBigInt(hash), N);
  const w = invMod(sig.s, N);
  const point = toAffine(add(multiply(G, (e * w) % N), multiply(toJacobian(q), (sig.r * w) % N)));
  return point !== null && mod(point.x, N) === sig.r;
}

/**
 * Recovers the signer's public key: Q = r⁻¹ · (s·R − e·G), where R is the curve point
 * with x = r (+ N if bit 1 of the recovery id is set) and the y parity given by bit 0.
 * @returns {Uint8Array|null} 33-byte compressed public key
 */
export function ecdsaRecover(hash, signature, recoveryId) {
  const sig = parseSignature(signature);
  if (!sig || !Number.isInteger(recoveryId) || recoveryId < 0 || recoveryId > 3) return null;
  const r = liftX(sig.r + (recoveryId & 2 ? N : 0n), recoveryId & 1);
  if (!r) return null;
  const e = mod(bytesToBigInt(hash), N);
  const rInv = invMod(sig.r, N);
  const q = toAffine(
    add(multiply(toJacobian(r), (sig.s * rInv) % N), multiply(G, mod(-e * rInv, N))),
  );
  return q ? compressPublicKey(q) : null;
}

/** Bitcoin nodes produce "low-S" signatures (s ≤ N/2); the other form is valid but non-standard. */
export function isHighS(signature) {
  return bytesToBigInt(signature.subarray(32, 64)) > N / 2n;
}

/** DER encoding of a 64-byte compact signature, the format openssl expects. */
export function derEncodeSignature(signature) {
  const body = concatBytes(
    derInteger(signature.subarray(0, 32)),
    derInteger(signature.subarray(32, 64)),
  );
  return concatBytes(Uint8Array.of(0x30, body.length), body);
}

function derInteger(bytes) {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  let value = bytes.subarray(start);
  if (value[0] & 0x80) value = concatBytes(Uint8Array.of(0), value); // keep it positive
  return concatBytes(Uint8Array.of(0x02, value.length), value);
}
