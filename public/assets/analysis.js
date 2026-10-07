// Batch decoding and compact analysis records. Statistical aggregation lives in statistics.js.
import { decodeInvoice, normalizeInvoice } from './bolt11/bolt11.js';
import { MAX_ISSUE_SAMPLES } from './bolt11/input.js';

const MAX_ISSUE_MESSAGE_LENGTH = 240;
const PROGRESS_INTERVAL_MS = 60;

function descriptionType(invoice) {
  if (invoice.description !== null && invoice.descriptionHash !== null) {
    return 'Both (non-conforming)';
  }
  if (invoice.description !== null) return 'Plain text';
  if (invoice.descriptionHash !== null) return 'Hash';
  return 'Missing (non-conforming)';
}

/** Keep only fields needed for statistics; never keep descriptions or full invoices. */
export function compactInvoice(invoice) {
  const routes = invoice.routeHints.filter((hops) => !hops.some((hop) => hop.sparkIdentity));
  return {
    timestamp: invoice.timestamp,
    network: invoice.network,
    amount: invoice.amountMsat,
    node: invoice.nodeId,
    explicitKey: invoice.signature.nodeIdInInvoice,
    paymentHash: invoice.paymentHash,
    targets: [...new Set(routes.map((hops) => hops[0].pubkey))],
    rawHints: invoice.fields.filter((field) => field.tag === 'r').length,
    hints: routes.length,
    hopLengths: routes.map((hops) => hops.length),
    spark: invoice.spark?.source ?? null,
    markerOnly: invoice.routeHints.length > 0 && routes.length === 0,
    description: descriptionType(invoice),
    expiry: invoice.expirySeconds,
    cltv: invoice.minFinalCltv,
    secret: invoice.paymentSecret !== null,
    metadata: invoice.metadata !== null,
    fallback: invoice.fallbacks.some((fallback) => fallback.version !== 31),
    features: (invoice.features ?? []).map(
      (feature) => `${feature.name} · ${feature.required ? 'required' : 'optional'}`,
    ),
    extension: invoice.fields.some((field) => !'psdmnhxcfr9'.includes(field.tag)),
    copies: 1,
  };
}

function addInvoice(raw, records, seen) {
  const normalized = normalizeInvoice(raw);
  // Validate mixed case before canonicalizing, so deduplication cannot hide invalid input.
  if (normalized !== normalized.toLowerCase() && normalized !== normalized.toUpperCase()) {
    throw new Error('The invoice mixes upper- and lower-case letters.');
  }

  const canonical = normalized.toLowerCase();
  const previous = seen.get(canonical);
  if (previous) {
    previous.copies++;
    return true;
  }

  const record = compactInvoice(decodeInvoice(normalized));
  records.push(record);
  seen.set(canonical, record);
  return false;
}

/** Analyze one invoice per line without allocating a second array for the whole input. */
export async function analyzeText(
  text,
  onProgress = () => {},
  yieldControl = () => new Promise((resolve) => setTimeout(resolve, 0)),
) {
  const records = [];
  const seen = new Map();
  const issues = [];
  let lines = 0;
  let nonempty = 0;
  let rejected = 0;
  let duplicates = 0;
  let lastProgress = performance.now();

  for (let start = 0; start < text.length; ) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const raw = text.slice(start, end).trim();
    start = end + 1;
    lines++;

    if (raw) {
      nonempty++;
      try {
        if (addInvoice(raw, records, seen)) duplicates++;
      } catch (error) {
        rejected++;
        if (issues.length < MAX_ISSUE_SAMPLES) {
          issues.push({ line: lines, message: error.message.slice(0, MAX_ISSUE_MESSAGE_LENGTH) });
        }
      }
    }

    if (performance.now() - lastProgress > PROGRESS_INTERVAL_MS) {
      onProgress({
        fraction: Math.min(start / text.length, 1),
        processed: nonempty,
        accepted: records.length,
        rejected,
      });
      await yieldControl();
      lastProgress = performance.now();
    }
  }

  onProgress({ fraction: 1, processed: nonempty, accepted: records.length, rejected });
  return { records, issues, nonempty, rejected, duplicates, lines };
}

// Re-export the statistics API so scripts can import decoding and aggregation from one module.
export { AMOUNT_BUCKETS, aggregate, nodeKey, timeBounds, timeline } from './statistics.js';
