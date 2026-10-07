// Application input safeguards, not BOLT11 protocol rules.

// Per-invoice decoding limits.
export const MAX_INVOICE_LENGTH = 16_384;
export const MAX_RAW_INVOICE_LENGTH = 32_768;
export const MAX_HEX_INPUT_LENGTH = 256;
export const MAX_FIELDS = 256;
export const MAX_ROUTE_HOPS = 64;
export const MAX_DATE_SECONDS = 8_640_000_000_000;

// Per-batch limit: analysis.js keeps at most this many rejected-line samples, and the dashboard
// says so. It lives here because the dashboard must not import the decoder through analysis.js.
export const MAX_ISSUE_SAMPLES = 100;

export function boundedText(input, max, label) {
  if (input == null) return '';
  if (typeof input !== 'string') throw new Error(`${label} must be text.`);
  if (input.length > max) throw new Error(`${label} is too long (maximum ${max} characters).`);
  return input;
}

/** Only ordinary ASCII paste whitespace is ignored; never fold Unicode lookalikes. */
export function normalizeInvoice(input) {
  const text = boundedText(input, MAX_RAW_INVOICE_LENGTH, 'Invoice')
    .replace(/[ \t\r\n]/g, '')
    .replace(/^lightning:/i, '');
  if (text.length > MAX_INVOICE_LENGTH)
    throw new Error(`Invoice is too long (maximum ${MAX_INVOICE_LENGTH} characters).`);
  if (/[^a-zA-Z0-9]/.test(text))
    throw new Error(
      'Invoice contains invalid characters (only ASCII letters and digits are allowed).',
    );
  return text;
}

export function normalizeHex(input) {
  return boundedText(input, MAX_HEX_INPUT_LENGTH, 'Hex input')
    .replace(/[ \t\r\n]/g, '')
    .replace(/^0x/i, '')
    .toLowerCase();
}

/** Deliberately strict, also usable at output boundaries without silently normalizing. */
export const isHex = (text, length) =>
  typeof text === 'string' && text.length === length && !/[^0-9a-f]/.test(text);
export const isNodeId = (text) => isHex(text, 66) && /^(02|03)/.test(text);

export function isCanonicalInvoice(text) {
  return (
    typeof text === 'string' &&
    text.length <= MAX_INVOICE_LENGTH &&
    !/[^a-z0-9]/.test(text) &&
    /^ln(bcrt|tbs|bc|tb|sb)[0-9]*[munp]?1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{117,}$/.test(text)
  );
}
