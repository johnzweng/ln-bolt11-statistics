// Progressive export guide for CLN/PostgreSQL and LND/lncli users.
import { exportQuery, paginatedLndExport } from './export-queries.js';

function outcomeNote(node, outcome) {
  if (outcome === 'success') {
    return 'Successful payments only. Failed attempts within a successful payment do not make it a failed payment.';
  }
  if (node === 'cln') {
    return 'Failed groups only: no pending or successful part in the same payment hash + group. A later retry in another group may still succeed.';
  }
  return 'Final FAILED payments only. IN_FLIGHT and INITIATED are excluded; failed HTLC attempts inside successful payments are not counted.';
}

function clickedOutside(dialog, event) {
  if (event.target !== dialog) return false;
  const bounds = dialog.getBoundingClientRect();
  return (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  );
}

async function copyCode(source, status) {
  try {
    await navigator.clipboard.writeText(source.textContent);
    status.textContent = 'Copied. Run it on your node.';
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(source);
    selection.removeAllRanges();
    selection.addRange(range);
    status.textContent = 'Clipboard unavailable. Command selected — press Ctrl+C / ⌘C to copy.';
  }
}

export function setupExportHelp() {
  const $ = (id) => document.getElementById(id);
  const dialog = $('export-help');
  let node = 'cln';
  let outcome = 'success';

  function render() {
    const cln = node === 'cln';
    const success = outcome === 'success';
    for (const button of dialog.querySelectorAll('[data-node]')) {
      button.setAttribute('aria-pressed', String(button.dataset.node === node));
    }
    for (const button of dialog.querySelectorAll('[data-outcome]')) {
      button.setAttribute('aria-pressed', String(button.dataset.outcome === outcome));
    }

    const months = Number($('export-months').value);
    $('export-code').textContent = exportQuery(node, outcome, months);
    $('export-language').textContent = cln ? 'POSTGRESQL' : 'BASH + JQ';
    $('export-copy').textContent = cln ? 'Copy SQL' : 'Copy command';
    $('export-copy-status').textContent = '';
    $('export-prerequisite').textContent = cln
      ? 'For CLN nodes using PostgreSQL. Run this read-only query against your node’s database.'
      : 'Run on your LND node with lncli and jq installed. Use your usual lncli connection options before listpayments.';
    $('export-outcome-note').textContent = outcomeNote(node, outcome);
    $('export-cln-tip').hidden = !cln;
    $('export-lnd-tip').hidden = cln;
    $('export-pagination').hidden = cln;
    $('export-pagination-code').textContent = paginatedLndExport(outcome, months);
    $('export-file-note').hidden = cln;
    $('export-file').textContent = `${success ? 'successful' : 'failed'}-invoices.txt`;
  }

  $('open-export-help').addEventListener('click', () => {
    render();
    dialog.showModal();
  });
  $('close-export-help').addEventListener('click', () => dialog.close());

  const restoreOpenerFocus = () => setTimeout(() => $('open-export-help').focus(), 0);
  dialog.addEventListener('close', restoreOpenerFocus);
  dialog.addEventListener('cancel', (event) => {
    // Close explicitly so Chromium cannot overwrite the restored focus after native cleanup.
    event.preventDefault();
    dialog.close();
  });
  dialog.addEventListener('click', (event) => {
    if (clickedOutside(dialog, event)) dialog.close();
  });

  for (const button of dialog.querySelectorAll('[data-node]')) {
    button.addEventListener('click', () => {
      node = button.dataset.node;
      render();
    });
  }
  for (const button of dialog.querySelectorAll('[data-outcome]')) {
    button.addEventListener('click', () => {
      outcome = button.dataset.outcome;
      render();
    });
  }
  $('export-months').addEventListener('change', render);
  const copyStatus = $('export-copy-status');
  $('export-copy').addEventListener('click', () => copyCode($('export-code'), copyStatus));
  $('export-pagination-copy').addEventListener('click', () =>
    copyCode($('export-pagination-code'), copyStatus),
  );
  render();
}
