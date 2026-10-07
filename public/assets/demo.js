// Synthetic, unsigned invoices: useful for exploration, never payable.
import { bech32Encode, bytesToWords, CHARSET } from './bolt11/bech32.js';
import { bigIntToBytes, concatBytes, hexToBytes } from './bolt11/bytes.js';
import { decodePublicKey } from './bolt11/secp256k1.js';
import { sha256 } from './bolt11/sha256.js';
import { SPARK_SCID_SENTINEL } from './bolt11/spark.js';

function integerWords(value, size = 0) {
  const words = [];
  do {
    words.unshift(value % 32);
    value = Math.floor(value / 32);
  } while (value);
  while (words.length < size) words.unshift(0);
  return words;
}
function tag(name, data) {
  return [CHARSET.indexOf(name), data.length >> 5, data.length & 31, ...data];
}
function demoKeys() {
  const result = [];
  for (let i = 0; result.length < 16; i++) {
    const key = concatBytes(
      Uint8Array.of(2),
      sha256(new TextEncoder().encode(`lens-demo-node-${i}`)),
    );
    if (decodePublicKey(key)) result.push(key);
  }
  return result;
}
function route(key, spark = false) {
  return bytesToWords(
    concatBytes(
      key,
      spark ? hexToBytes(SPARK_SCID_SENTINEL) : bigIntToBytes(800000n * 2n ** 40n + 256n, 8),
      bigIntToBytes(1000n, 4),
      bigIntToBytes(250n, 4),
      bigIntToBytes(40n, 2),
    ),
  );
}
// Oldest to newest: quiet launch, small-payment rush, large payments,
// a lull, Spark-heavy activity, then larger payments through new destinations.
// Activity weights affect volume; each period retains a varied invoice mix.
const DEMO_PERIODS = [
  { weight: 1, destination: 0, amountExponent: 1.5, amountSpread: 2.5,
    spark: 0.02, routes: 0.15, extraRoute: 0.03, amountless: 0.18, descriptionHash: 0.1,
    expiry: [600, 600, 3600], cltv: [18, 18, 40] },
  { weight: 4, destination: 2, amountExponent: 2, amountSpread: 2,
    spark: 0.08, routes: 0.4, extraRoute: 0.12, amountless: 0.05, descriptionHash: 0.2,
    expiry: [3600, 3600, 86400], cltv: [18, 18, 40] },
  { weight: 2, destination: 4, amountExponent: 4.5, amountSpread: 2,
    spark: 0.12, routes: 0.8, extraRoute: 0.5, amountless: 0.02, descriptionHash: 0.65,
    expiry: [86400, 604800, 604800], cltv: [40, 80, 80] },
  { weight: 1, destination: 6, amountExponent: 2.5, amountSpread: 2,
    spark: 0.25, routes: 0.3, extraRoute: 0.1, amountless: 0.25, descriptionHash: 0.5,
    expiry: [600, 600, 3600], cltv: [18, 40, 40] },
  { weight: 5, destination: 8, amountExponent: 1.5, amountSpread: 2.5,
    spark: 0.75, routes: 0.7, extraRoute: 0.35, amountless: 0.08, descriptionHash: 0.1,
    expiry: [3600, 3600, 86400], cltv: [40, 40, 80] },
  { weight: 3, destination: 10, amountExponent: 4, amountSpread: 2.5,
    spark: 0.45, routes: 0.9, extraRoute: 0.65, amountless: 0.02, descriptionHash: 0.75,
    expiry: [86400, 604800, 604800], cltv: [40, 80, 80] },
];

export function createDemo(count = 3000) {
  const keys = demoKeys(),
    output = [];
  const now = Math.floor(Date.now() / 1000);
  let seed = 1803;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const span = 3 * 365 * 86400;
  const periodSpan = span / DEMO_PERIODS.length;
  const totalWeight = DEMO_PERIODS.reduce((sum, period) => sum + period.weight, 0);
  const pick = (values) => values[Math.floor(random() * values.length)];
  for (let i = 0; i < count; i++) {
    let ticket = random() * totalWeight;
    let periodIndex = 0;
    while (ticket >= DEMO_PERIODS[periodIndex].weight) {
      ticket -= DEMO_PERIODS[periodIndex++].weight;
    }
    // Anchor the full window, even when a period has relatively little activity.
    if (i === 0) periodIndex = 0;
    if (i === 1) periodIndex = DEMO_PERIODS.length - 1;
    const period = DEMO_PERIODS[periodIndex];
    // Background activity plus two loose bursts within each half-year period.
    const progress = random() < 0.65
      ? pick([0.2, 0.7]) + (random() - 0.5) * 0.16
      : random();
    const elapsed = i === 0 ? 0 : i === 1 ? span - 1
      : Math.floor((periodIndex + progress) * periodSpan);
    const timestamp = now - span + elapsed;
    const destination = random() < 0.8
      ? (period.destination + Math.floor(random() ** 2 * 3)) % 12
      : Math.floor(random() * 12);
    const amount = Math.max(1,
      Math.floor(10 ** (period.amountExponent + random() * period.amountSpread)));
    const hash = sha256(new TextEncoder().encode(`local-demo-${i}`));
    const spark = random() < period.spark;
    const amountless = random() < period.amountless;
    const routeTarget = random() < 0.8 ? periodIndex % 3 : Math.floor(random() * 3);
    const fields = [
      ...tag('p', bytesToWords(hash)),
      ...tag('s', bytesToWords(hash)),
      ...tag('n', bytesToWords(keys[destination])),
      ...(random() < period.descriptionHash
        ? tag('h', bytesToWords(hash))
        : tag('d', bytesToWords(new TextEncoder().encode('Synthetic demo — not payable')))),
      ...tag('x', integerWords(pick(period.expiry))),
      ...tag('c', integerWords(pick(period.cltv))),
      ...tag('9', integerWords((1 << 15) | (1 << 17))),
    ];
    if (random() < period.routes || spark) fields.push(...tag('r', route(keys[12 + routeTarget])));
    if (random() < period.extraRoute) {
      fields.push(...tag('r', route(keys[12 + ((routeTarget + 1) % 3)])));
    }
    if (spark) fields.push(...tag('r', route(keys[15], true)));
    const prefix = `ln${i % 29 === 0 ? 'tb' : 'bc'}${amountless ? '' : amount * 10 + 'n'}`;
    output.push(
      bech32Encode(prefix, [...integerWords(timestamp, 7), ...fields, ...new Array(104).fill(0)]),
    );
  }
  output.push(output[0], output[1]);
  return output.join('\n');
}
