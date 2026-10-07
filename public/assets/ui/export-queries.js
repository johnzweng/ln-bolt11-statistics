// Read-only node exports. No credentials, node connection, or query execution in the browser.
function validateExport(node, outcome, months) {
  if (!['cln', 'lnd'].includes(node) || !['success', 'failed'].includes(outcome))
    throw new Error('Unknown export');
  if (!Number.isInteger(months) || months < 1 || months > 24)
    throw new Error('Invalid month window');
}

export function exportQuery(node, outcome, months = 6) {
  validateExport(node, outcome, months);
  if (node === 'cln') {
    const failed = outcome === 'failed';
    return `SELECT DISTINCT p.bolt11
FROM public.payments AS p
WHERE p.status = ${failed ? '2 -- PAYMENT_FAILED' : '1 -- PAYMENT_COMPLETE'}
  AND p.bolt11 ~* '^ln(bc|tb|tbs|bcrt|sb)'
  AND p.timestamp > extract(epoch FROM now() - interval '${months} months')${
    failed
      ? `
  AND NOT EXISTS (
    SELECT 1
    FROM public.payments AS other
    WHERE other.payment_hash = p.payment_hash
      AND other.groupid = p.groupid
      AND other.status IN (0, 1) -- pending or complete
  )`
      : ''
  }
ORDER BY p.bolt11;`;
  }
  return `# Run in Bash on your node. Requires jq; Linux or macOS date.
set -o pipefail
start=$(date -d '${months} months ago' +%s 2>/dev/null || date -v-${months}m +%s) &&
lncli listpayments --include_incomplete --max_payments=18446744073709551615 \\
  --creation_date_start="$start" |
  jq -r '.payments[]
    | select(.status == "${outcome === 'success' ? 'SUCCEEDED' : 'FAILED'}")
    | .payment_request // empty
    | select(test("^ln(bc|tb|tbs|bcrt|sb)"; "i"))' \\
  > ${outcome === 'success' ? 'successful' : 'failed'}-invoices.txt`;
}

// No server-side filters: an empty raw page is an unambiguous end of history.
export function paginatedLndExport(outcome, months = 6) {
  validateExport('lnd', outcome, months);
  return `# Bash + jq. Scans history in bounded pages; filters locally.
# A failed command may leave a partial file. Import only after success.
(
  set -euo pipefail
  start=$(date -d '${months} months ago' +%s 2>/dev/null || date -v-${months}m +%s)
  offset=0
  while :; do
    page=$(lncli listpayments --include_incomplete --paginate_forwards \\
      --index_offset="$offset" --max_payments=500)
    count=$(jq -r '(.payments // []) | length' <<< "$page")
    [ "$count" -eq 0 ] && break
    jq -r --argjson start "$start" '
      .payments[]
      | select(.status == "${outcome === 'success' ? 'SUCCEEDED' : 'FAILED'}")
      | select((.creation_time_ns | tonumber) / 1000000000 >= $start)
      | .payment_request // empty
      | select(test("^ln(bc|tb|tbs|bcrt|sb)"; "i"))' <<< "$page"
    next=$(jq -er '.last_index_offset | tostring' <<< "$page")
    if [[ ! "$next" =~ ^[0-9]+$ || "$next" == "$offset" ]]; then
      echo 'Payment cursor did not advance; export incomplete.' >&2
      exit 1
    fi
    offset=$next
  done
) > ${outcome === 'success' ? 'successful' : 'failed'}-invoices.txt`;
}
