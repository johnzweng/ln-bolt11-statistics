// Best-effort, bounded third-party lookups. A node alias is untrusted text, never identity proof.
import { isNodeId } from '../bolt11/input.js';

const MEMPOOL_NODE_API = 'https://mempool.space/api/v1/lightning/nodes/';
const LOOKUP_TIMEOUT_MS = 9000;
export const MAX_LOOKUPS = 64; // total distinct keys per page load, including failures
export const MAX_CONCURRENT_LOOKUPS = 4;
export const MAX_RESPONSE_BYTES = 65_536;
const lookups = new Map();
const queue = [];
let active = 0;

export function lookupNode(pubkey) {
  if (!isNodeId(pubkey)) return Promise.resolve({ status: 'unavailable' });
  if (lookups.has(pubkey)) return lookups.get(pubkey);
  if (lookups.size >= MAX_LOOKUPS) return Promise.resolve({ status: 'unavailable' });
  const result = new Promise((resolve) => queue.push({ pubkey, resolve }));
  lookups.set(pubkey, result);
  drain();
  return result;
}

function drain() {
  while (active < MAX_CONCURRENT_LOOKUPS && queue.length) {
    const { pubkey, resolve } = queue.shift();
    active++;
    fetchNode(pubkey)
      .then(resolve)
      .finally(() => {
        active--;
        drain();
      });
  }
}

/** Only bounded fields actually used by the UI survive this boundary. */
export function parseNode(data, pubkey) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.public_key !== pubkey)
    return null;
  const alias = typeof data.alias === 'string' ? data.alias.slice(0, 128) : '';
  const active_channel_count =
    Number.isSafeInteger(data.active_channel_count) &&
    data.active_channel_count >= 0 &&
    data.active_channel_count <= 1_000_000_000
      ? data.active_channel_count
      : null;
  return { alias, active_channel_count, capacity: parseCapacity(data.capacity) };
}

/** Keep decimal strings exact, including values beyond Number's safe integer range. */
function parseCapacity(value) {
  const isSafeNumber = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const digits = isSafeNumber ? String(value) : value;
  // 1 to 16 ASCII digits; no sign, decimal point, exponent, or whitespace.
  return typeof digits === 'string' && /^[0-9]{1,16}$/.test(digits) ? digits : null;
}

/** Bound the actual stream bytes, not a server-supplied Content-Length header. */
async function readBoundedJson(body) {
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Node response too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function fetchNode(pubkey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(MEMPOOL_NODE_API + pubkey, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      return {
        status: response.status === 404 || response.status === 500 ? 'unknown' : 'unavailable',
      };
    }
    const node = parseNode(await readBoundedJson(response.body), pubkey);
    return node ? { status: 'public', node } : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}
