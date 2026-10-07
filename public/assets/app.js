// Lightning Lens — input handling, worker lifecycle, filters, and dashboard coordination.
import { timeBounds } from './statistics.js';
import { createDemo } from './demo.js';
import { renderDashboard, renderInputQuality } from './ui/dashboard.js';
import { setupExportHelp } from './ui/export-help.js';
import { copy, csv, number, toast, utcDate, utcInput } from './ui/helpers.js';
import { NodePanel } from './ui/node-panel.js';

const $ = (id) => document.getElementById(id);
const RESULT_CONTAINER_IDS = [
  'metrics',
  'timeline',
  'amount-chart',
  'amount-summary',
  'anatomy',
  'expiry-chart',
  'cltv-chart',
  'hints-chart',
  'features-chart',
  'context',
  'quality-details',
];

const destinations = new NodePanel($('destinations'), {
  title: 'Real destinations',
  subtitle:
    'Receiver keys, including private nodes. Each invoice is counted once at its destination. ' +
    'No public-network lookup is needed.',
});
const targets = new NodePanel($('targets'), {
  title: 'Effective routing targets',
  target: true,
  subtitle:
    'Distinct first nodes of real hint routes; otherwise the destination. One invoice can count ' +
    'toward several alternatives. Spark identity markers are excluded.',
});

let worker = null;
let dataset = null;
let bounds = null;
let stats = null;
let datasetIsDemo = false;
let inputIsDemo = false;
let renderFrame = 0;
let floatingFrame = 0;
let countTimer;
let originalSlidersPassed = false;
let resultsEndNear = false;
let options = {
  from: 0,
  to: 0,
  network: 'all',
  includeDuplicates: false,
};

function countInputLines() {
  clearTimeout(countTimer);
  countTimer = setTimeout(() => {
    let count = 0;
    for (const match of $('invoices').value.matchAll(/[^\r\n]+/g)) {
      if (match[0].trim()) count++;
    }
    $('line-count').textContent = count ? `${number(count)} input lines` : 'Ready when you are';
  }, 150);
}

function setBusy(value) {
  $('analyze').disabled = value;
  $('demo').disabled = value;
  $('file').disabled = value;
  $('cancel').hidden = !value;
  $('progress-area').hidden = !value;
}

function stopWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  setBusy(false);
}

function failAnalysis(message) {
  stopWorker();
  $('results').hidden = !dataset?.records.length;
  $('input-status').textContent = message;
}

function showProgress(data) {
  $('progress').value = data.fraction;
  $('progress-percent').textContent = `${Math.round(data.fraction * 100)}%`;
  $('progress-label').textContent =
    `${number(data.processed)} lines processed · ` +
    `${number(data.accepted)} unique decoded · ${number(data.rejected)} rejected`;
}

function finishAnalysis(result, { demo, started }) {
  dataset = result;
  datasetIsDemo = demo;
  stopWorker();

  $('input-status').textContent =
    `Finished in ${((performance.now() - started) / 1000).toFixed(1)}s · ` +
    `${number(dataset.records.length)} unique invoices decoded · ` +
    `${number(dataset.duplicates)} duplicate lines · ${number(dataset.rejected)} rejected.`;

  if (!dataset.records.length) {
    const issueSummary = dataset.issues
      .slice(0, 3)
      .map((issue) => `Line ${issue.line}: ${issue.message}`)
      .join('\n');
    if (issueSummary) $('input-status').textContent += `\n${issueSummary}`;
    return;
  }

  bounds = timeBounds(dataset.records);
  options = {
    from: bounds.from,
    to: bounds.to,
    network: 'all',
    includeDuplicates: false,
  };
  $('network').value = 'all';
  $('duplicates').checked = false;
  $('results').hidden = false;
  $('demo-notice').hidden = !demo;
  $('dataset-summary').textContent =
    `${number(dataset.records.length)} unique invoices · ` +
    `${utcDate(bounds.from)} — ${utcDate(bounds.to)}`;
  $('timeline-start').textContent = utcDate(bounds.from);
  $('timeline-end').textContent = utcDate(bounds.to);
  for (const id of [
    'from-slider',
    'to-slider',
    'floating-from-slider',
    'floating-to-slider',
  ]) {
    $(id).disabled = bounds.from === bounds.to;
  }
  $('from-date').min = utcInput(bounds.from);
  $('from-date').max = utcInput(bounds.to);
  $('to-date').min = utcInput(bounds.from);
  $('to-date').max = utcInput(bounds.to);

  renderInputQuality(dataset);
  syncTimeControls();
  render();
  $('results').scrollIntoView({
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    block: 'start',
  });
}

function handleWorkerMessage(data, context) {
  if (data.type === 'progress') showProgress(data);
  else if (data.type === 'done') finishAnalysis(data.result, context);
  else if (data.type === 'error') failAnalysis(data.message);
}

function startAnalysis() {
  if (!$('invoices').value.trim()) {
    $('input-status').textContent = 'Paste at least one BOLT11 invoice, or explore the demo.';
    $('invoices').focus();
    return;
  }

  stopWorker();
  setBusy(true);
  $('results').hidden = true;
  originalSlidersPassed = false;
  updateFloatingTimeControls();
  $('progress').value = 0;
  $('progress-percent').textContent = '0%';
  $('progress-label').textContent = 'Starting background decoder…';
  $('input-status').textContent = '';
  const context = { started: performance.now(), demo: inputIsDemo };

  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => handleWorkerMessage(data, context);
    worker.onerror = () =>
      failAnalysis(
        'The background decoder could not run. Serve the public/ directory over HTTP ' +
          '(localhost) or HTTPS, rather than opening a file:// URL.',
      );
    worker.postMessage({ text: $('invoices').value });
  } catch {
    failAnalysis(
      'Web Workers are required. Open the application over localhost or HTTPS in a modern browser.',
    );
  }
}

function clearAnalysis() {
  stopWorker();
  dataset = null;
  stats = null;
  bounds = null;
  inputIsDemo = false;
  datasetIsDemo = false;
  $('invoices').value = '';
  $('results').hidden = true;
  originalSlidersPassed = false;
  resultsEndNear = false;
  updateFloatingTimeControls();
  $('input-status').textContent = 'Input and analysis cleared from this tab.';
  destinations.update([], false);
  targets.update([], false);
  for (const id of RESULT_CONTAINER_IDS) $(id).replaceChildren();
  $('dataset-summary').textContent = '';
  $('window-label').textContent = '';
  countInputLines();
}

function syncTimeControls() {
  if (!bounds) return;
  const span = bounds.to - bounds.from;
  const values = {
    from: span ? Math.round(((options.from - bounds.from) / span) * 1000) : 0,
    to: span ? Math.round(((options.to - bounds.from) / span) * 1000) : 1000,
  };
  for (const side of ['from', 'to']) {
    for (const prefix of ['', 'floating-']) {
      const slider = $(`${prefix}${side}-slider`);
      slider.value = values[side];
      slider.setAttribute('aria-valuetext', `${utcInput(options[side])} UTC`);
    }
  }
  $('from-date').value = utcInput(options.from);
  $('to-date').value = utcInput(options.to);
}

function setTimeBoundary(side, value) {
  options[side] = value;
  if (options.from > options.to) {
    options[side === 'from' ? 'to' : 'from'] = value;
  }
  syncTimeControls();
  scheduleRender();
}

function scheduleRender() {
  cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(render);
}

function render() {
  if (!dataset?.records.length || !bounds) return;
  stats = renderDashboard({
    dataset,
    bounds,
    options,
    datasetIsDemo,
    destinations,
    targets,
  });
  $('floating-window-label').textContent = $('window-label').textContent;
}

function setupTimeControls() {
  for (const side of ['from', 'to']) {
    for (const prefix of ['', 'floating-']) {
      $(`${prefix}${side}-slider`).addEventListener('input', (event) => {
        if (!bounds) return;
        const fraction = Number(event.target.value) / 1000;
        setTimeBoundary(side, bounds.from + Math.round(fraction * (bounds.to - bounds.from)));
      });
    }

    $(`${side}-date`).addEventListener('change', (event) => {
      if (!bounds) return;
      const value = Date.parse(`${event.target.value}Z`) / 1000;
      if (!Number.isFinite(value)) {
        syncTimeControls();
        toast('Enter a valid UTC date and time');
        return;
      }
      setTimeBoundary(side, Math.max(bounds.from, Math.min(bounds.to, Math.floor(value))));
    });
  }
}

function updateFloatingTimeControls() {
  const card = $('floating-time-controls');
  const hasFocusedControl = card.contains(document.activeElement);
  const visible =
    Boolean(dataset?.records.length) &&
    !$('results').hidden &&
    (hasFocusedControl || (originalSlidersPassed && !resultsEndNear));
  card.classList.toggle('is-visible', visible);
  card.setAttribute('aria-hidden', String(!visible));
}

function checkFloatingBoundaries() {
  cancelAnimationFrame(floatingFrame);
  floatingFrame = requestAnimationFrame(() => {
    const sliderRect = document.querySelector('.time-panel .sliders').getBoundingClientRect();
    const endRect = $('results-end').getBoundingClientRect();
    originalSlidersPassed = sliderRect.bottom <= 0;
    resultsEndNear = endRect.top <= innerHeight + 110;
    updateFloatingTimeControls();
  });
}

function setupFloatingTimeControls() {
  const originalSliders = document.querySelector('.time-panel .sliders');
  const resultsEnd = $('results-end');

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      originalSlidersPassed =
        !entry.isIntersecting && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0);
      updateFloatingTimeControls();
    }).observe(originalSliders);

    new IntersectionObserver(
      ([entry]) => {
        resultsEndNear =
          entry.isIntersecting &&
          entry.boundingClientRect.top <= (entry.rootBounds?.bottom ?? innerHeight + 110);
        if (entry.boundingClientRect.top <= (entry.rootBounds?.top ?? 0)) resultsEndNear = true;
        updateFloatingTimeControls();
      },
      { rootMargin: '0px 0px 110px 0px' },
    ).observe(resultsEnd);
  }

  addEventListener('scroll', checkFloatingBoundaries, { passive: true });
  addEventListener('resize', checkFloatingBoundaries);
  $('floating-time-controls').addEventListener('focusout', () => {
    requestAnimationFrame(updateFloatingTimeControls);
  });
}

function setupInputActions() {
  $('invoices').addEventListener('input', () => {
    inputIsDemo = false;
    countInputLines();
  });
  $('demo').addEventListener('click', () => {
    $('invoices').value = createDemo();
    inputIsDemo = true;
    countInputLines();
    startAnalysis();
  });
  $('file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      $('invoices').value = await file.text();
      inputIsDemo = false;
      countInputLines();
      $('input-status').textContent = 'File loaded locally. Ready to analyze.';
    } catch {
      $('input-status').textContent = 'Could not read this file.';
    }
    event.target.value = '';
  });
  $('clear').addEventListener('click', clearAnalysis);
  $('cancel').addEventListener('click', () => {
    stopWorker();
    $('results').hidden = !dataset?.records.length;
    $('input-status').textContent = 'Analysis cancelled. Previous results, if any, are unchanged.';
  });
  $('analyze').addEventListener('click', startAnalysis);
}

function setupFilters() {
  $('network').addEventListener('change', (event) => {
    options.network = event.target.value;
    scheduleRender();
  });
  $('duplicates').addEventListener('change', (event) => {
    options.includeDuplicates = event.target.checked;
    scheduleRender();
  });
  $('reset-time').addEventListener('click', () => {
    if (!bounds) return;
    options.from = bounds.from;
    options.to = bounds.to;
    syncTimeControls();
    scheduleRender();
  });
  $('copy-features').addEventListener('click', () => {
    if (!stats) return;
    const rows = [...(stats.categories.features ?? [])]
      .sort((a, b) => b[1] - a[1])
      .map(([feature, count]) => [
        feature,
        count,
        stats.count ? ((count / stats.count) * 100).toFixed(3) : '0',
      ]);
    copy(csv([['feature', 'invoices', 'share_percent'], ...rows]), 'lightning-lens-features.csv');
  });
}

setupExportHelp();
setupInputActions();
setupTimeControls();
setupFloatingTimeControls();
setupFilters();
window.addEventListener('node-info-updated', () => {
  if (!stats) return;
  destinations.update(stats.destinations, datasetIsDemo);
  targets.update(stats.targets, datasetIsDemo);
});

if (location.protocol === 'file:') {
  $('input-status').textContent =
    'Open over localhost or HTTPS to enable JavaScript modules and background workers. ' +
    'See README.md.';
}
