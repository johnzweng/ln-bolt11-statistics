export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name.startsWith('on') && typeof value === 'function')
      node.addEventListener(name.slice(2), value);
    else if (value !== null && value !== undefined) node.setAttribute(name, String(value));
  }
  node.append(
    ...children
      .flat()
      .filter((v) => v !== null && v !== undefined)
      .map((v) => (v instanceof Node ? v : document.createTextNode(String(v)))),
  );
  return node;
}
export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  node.append(
    ...children.flat().map((v) => (v instanceof Node ? v : document.createTextNode(String(v)))),
  );
  return node;
}
const numberFormatter = new Intl.NumberFormat('en-US');
export const number = (value) => numberFormatter.format(value);
// percent(1, 8) → "12.5%".
export const percent = (part, total) => (total ? ((part / total) * 100).toFixed(1) + '%' : '0%');
// sats(1_001n) → "1.001".
export function sats(msat) {
  if (msat === null || msat === undefined) return '—';
  const fraction = (msat % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return number(msat / 1000n) + (fraction ? '.' + fraction : '');
}
// btc(123_456_789) → "1.23456789 BTC".
export function btc(sat) {
  const value = BigInt(sat);
  const whole = number(value / 100_000_000n);
  const fraction = (value % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '') || '0';
  return `${whole}.${fraction} BTC`;
}
// "02abcdef…12345678" keeps both identifying ends of a node key.
export const shortKey = (key) => `${key.slice(0, 10)}…${key.slice(-8)}`;
export const utcDate = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);
export const utcInput = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 19);
/** Strip control and bidi-formatting characters from untrusted display labels. */
export function safeLabel(value) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .slice(0, 128);
}
export function external(url, label) {
  return el(
    'a',
    { href: url, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer' },
    label,
  );
}
/** Quote every CSV cell and neutralize spreadsheet formulas in untrusted text. */
export function csv(rows) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          let text = String(value ?? '');
          if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
          return '"' + text.replaceAll('"', '""') + '"';
        })
        .join(','),
    )
    .join('\r\n');
}
let toastTimer;
export function toast(message) {
  const target = document.getElementById('toast');
  target.textContent = message;
  target.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    target.hidden = true;
  }, 3500);
}
export function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function copy(text, filename = 'lightning-lens.csv') {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    download(text, filename);
    toast('Clipboard unavailable · downloaded instead');
  }
}
