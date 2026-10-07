import { el, svg, number, percent, sats, utcDate } from './helpers.js';
const COLORS = ['var(--violet)', 'var(--teal)', 'var(--orange)', 'var(--gray)'];
export function bar(fraction, color = 'var(--violet)') {
  return svg(
    'svg',
    { class: 'rank-bar', viewBox: '0 0 100 7', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    svg('rect', { width: 100, height: 7, rx: 2, class: 'bar-track' }),
    svg('rect', {
      width: Math.max(0, Math.min(100, fraction * 100)),
      height: 7,
      rx: 2,
      fill: color,
    }),
  );
}
export function miniBars(map, { maxItems = 8, numeric = false, denominator, color } = {}) {
  const entries = [...(map ?? [])];
  entries.sort(
    numeric
      ? (a, b) => parseInt(a[0]) - parseInt(b[0])
      : (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const shown = entries.slice(0, maxItems);
  if (entries.length > maxItems)
    shown.push(['Other', entries.slice(maxItems).reduce((sum, [, n]) => sum + n, 0)]);
  if (!shown.length) return el('div', { class: 'empty-chart' }, 'No data in this window');
  const max = Math.max(1, ...shown.map(([, n]) => n));
  return el(
    'div',
    {},
    shown.map(([label, value]) =>
      el(
        'div',
        { class: 'mini-bar-row' },
        el(
          'div',
          { class: 'mini-bar-label' },
          el('span', {}, label),
          el('b', {}, number(value), denominator ? ` · ${percent(value, denominator)}` : ''),
        ),
        bar(value / max, color),
      ),
    ),
  );
}
export function donut(title, map, total, primary) {
  const sorted = [...(map ?? [])].sort((a, b) => b[1] - a[1]);
  // The center always describes the first, explicitly named signal—not whichever side is larger.
  const entries = primary
    ? [[primary, map?.get(primary) ?? 0], ...sorted.filter(([label]) => label !== primary)]
    : sorted;
  const ring = svg('svg', {
    class: 'donut',
    viewBox: '0 0 70 70',
    role: 'img',
    'aria-label': title + ': ' + entries.map(([k, v]) => `${k} ${v}`).join(', '),
  });
  ring.append(svg('circle', { cx: 35, cy: 35, r: 26, class: 'donut-track' }));
  const circumference = 2 * Math.PI * 26;
  let offset = 0;
  for (const [i, [, count]] of entries.entries()) {
    const length = total ? (count / total) * circumference : 0;
    ring.append(
      svg('circle', {
        cx: 35,
        cy: 35,
        r: 26,
        class: 'donut-segment',
        stroke: COLORS[i % COLORS.length],
        'stroke-dasharray': `${length} ${Math.max(0, circumference - length)}`,
        'stroke-dashoffset': -offset,
        transform: 'rotate(-90 35 35)',
      }),
    );
    offset += length;
  }
  ring.append(
    svg(
      'text',
      { x: 35, y: 40, 'text-anchor': 'middle', class: 'donut-center' },
      total ? Math.round(((entries[0]?.[1] ?? 0) / total) * 100) + '%' : '—',
    ),
  );
  return el(
    'div',
    { class: 'anatomy-item' },
    ring,
    el(
      'div',
      {},
      el('h4', {}, title),
      el(
        'ul',
        {},
        entries.length
          ? entries.map(([label, value], i) =>
              el(
                'li',
                {},
                el('i', { class: `legend-swatch swatch-${i}` }),
                label,
                el('b', {}, `${number(value)} · ${percent(value, total)}`),
              ),
            )
          : el('li', {}, 'No invoices'),
      ),
    ),
  );
}
export function amountHistogram(buckets, amountless) {
  const chart = svg('svg', {
    viewBox: '0 0 510 220',
    class: 'chart-svg',
    role: 'img',
    'aria-label': 'Amount distribution: ' + buckets.map((b) => `${b.label}: ${b.count}`).join(', '),
  });
  const maximum = Math.max(1, ...buckets.map((b) => b.count));
  for (let i = 0; i <= 3; i++) {
    const y = 172 - i * 48;
    chart.append(svg('line', { x1: 14, x2: 505, y1: y, y2: y, class: 'chart-axis' }));
  }
  buckets.forEach((bucket, i) => {
    const height = (bucket.count / maximum) * 138;
    const x = i * 71 + 21;
    chart.append(
      svg(
        'rect',
        {
          x,
          y: 172 - height,
          width: 49,
          height: Math.max(bucket.count ? 2 : 0, height),
          rx: 5,
          class: 'hist-bar',
        },
        svg(
          'title',
          {},
          `${bucket.label}: ${number(bucket.count)} invoices, ${sats(bucket.amount)} sats requested`,
        ),
      ),
    );
    chart.append(
      svg(
        'text',
        { x: x + 24.5, y: 162 - height, 'text-anchor': 'middle', class: 'chart-value' },
        number(bucket.count),
      ),
    );
    chart.append(
      svg(
        'text',
        { x: x + 24.5, y: 197, 'text-anchor': 'middle', class: 'chart-text' },
        bucket.label,
      ),
    );
  });
  return el(
    'div',
    {},
    chart,
    el(
      'p',
      { class: 'fine-print' },
      `${number(amountless)} amountless invoices excluded. Their actual payment amounts cannot be inferred.`,
    ),
  );
}
export function timelineChart(bins) {
  const chart = svg('svg', {
    viewBox: '0 0 1000 82',
    preserveAspectRatio: 'none',
    role: 'img',
    'aria-label': `${number(bins.reduce((s, b) => s + b.count, 0))} invoices across ${bins.length} equal time intervals; violet shows selected invoices`,
  });
  const max = Math.max(1, ...bins.map((b) => b.count));
  bins.forEach((b, i) => {
    const width = 1000 / bins.length;
    const totalHeight = (b.count / max) * 78;
    const selectedHeight = (b.selected / max) * 78;
    const group = svg(
      'g',
      {},
      svg(
        'title',
        {},
        `${utcDate(b.from)}–${utcDate(b.to)} UTC: ${number(b.count)} invoices, ${number(b.selected)} selected`,
      ),
    );
    group.append(
      svg('rect', {
        x: i * width + 2,
        y: 82 - totalHeight,
        width: width - 4,
        height: totalHeight,
        rx: 2,
        fill: 'var(--gray)',
      }),
    );
    if (selectedHeight)
      group.append(
        svg('rect', {
          x: i * width + 2,
          y: 82 - selectedHeight,
          width: width - 4,
          height: selectedHeight,
          rx: 2,
          fill: 'var(--violet)',
        }),
      );
    chart.append(group);
  });
  return chart;
}
