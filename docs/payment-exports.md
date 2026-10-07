# Payment exports: research and UI decisions

## Scope and design

Help node operators export outgoing BOLT11 invoices for a chosen lookback period
without connecting this static application to a node. The UI assumes a modern browser
and either CLN PostgreSQL access or a working LND `lncli`; it stores no credentials or
data and has no runtime dependencies.

A **How to export from your node** button opens a native modal with node, outcome, and
lookback selectors. It shows one recipe at a time and keeps technical details collapsed.
The default is CLN / successful / six months.

No query runs in the browser. Source links are ordinary user-opened links, with no
implicit remote requests. No preimages are selected or exported. Maintenance: update
`public/assets/ui/export-queries.js` and its tests if upstream interfaces change.

## CLN payment semantics

Verified against CLN tag **v26.06.9**:

- [`wallet/wallet.h`, lines 324–380](https://github.com/ElementsProject/lightning/blob/v26.06.9/wallet/wallet.h#L324-L380): pending = 0, complete = 1, failed = 2. The preimage is present if and only if complete in normal wallet data. `invstring` can be BOLT11 **or BOLT12**, despite the SQL column's `bolt11` name.
- [`wallet/migrations.c`, lines 751–782](https://github.com/ElementsProject/lightning/blob/v26.06.9/wallet/migrations.c#L751-L782): `id` is a primary key; `(payment_hash, partid, groupid)` is unique. Different groups permit repeated payment attempts.
- [`wallet/wallet.c`, lines 4327–4365](https://github.com/ElementsProject/lightning/blob/v26.06.9/wallet/wallet.c#L4327-L4365): status, completion time, and preimage are updated by the wallet.
- The default xpay plugin groups parts by payment hash and group ID, [collects their states in `plugins/xpay/listpays.c`, lines 306–324](https://github.com/ElementsProject/lightning/blob/v26.06.9/plugins/xpay/listpays.c#L306-L324), and [resolves them as complete, then pending, then failed (lines 160–165)](https://github.com/ElementsProject/lightning/blob/v26.06.9/plugins/xpay/listpays.c#L160-L165).

### Row/group selection semantics

Successful:

```sql
SELECT DISTINCT ON (payment_hash, groupid) bolt11
FROM public.payments
WHERE status = 1
  AND bolt11 IS NOT NULL
  AND timestamp > extract(epoch FROM now() - interval '6 months')
ORDER BY payment_hash, groupid, id DESC;
```

The corresponding non-successful query uses `status <> 1`.
That preserves **pending + failed parts**, not "terminally failed payments".
Preimage predicates can be kept as integrity guards if intentionally inspecting
inconsistent/corrupt data; removing them assumes normal CLN wallet invariants.
`completed_at DESC NULLS LAST` is redundant because `id DESC` already uniquely
orders rows. It never breaks a tie. The selected row is the newest _matching_ part,
not necessarily the newest part overall, since WHERE runs before DISTINCT ON.

### Recipes used in the UI

The UI selects **distinct invoice strings**, not distinct payment groups. This is
an intentional change: Lightning Lens analyzes invoices and already deduplicates
identical invoice strings by default. Multiple groups with the same invoice collapse.
No representative-row ordering is needed; `ORDER BY bolt11` gives stable output.
The BOLT11 prefix filter also skips NULL, empty strings, BOLT12, and keysend.

Success: at least one complete part created inside the window.
Failure: a failed part created inside the window, with **no pending or complete part
anywhere in that same hash/group**. The NOT EXISTS check deliberately has no date
or invoice filter: a part outside the window must still prevent misclassification.
This is a stored-group snapshot, not proof that a pay plugin cannot retry again.
An earlier failed group can coexist with a later successful group for the same invoice;
the exports are not disjoint lifetime-success/failure sets.

Use the generated SQL with PostgreSQL, not the SQLite wallet or CLN SQL plugin.
Save the SQL in `query.sql` and use `psql -At <connection options> -f query.sql > invoices.txt`
to avoid headers, borders, or CSV quoting. Do not export preimages.

## LND: supported equivalent, not universal SQL

LND's usual outgoing-payment storage is key/value, not CLN's public.payments schema.
Even a SQL backend can store KV abstractions; native outgoing-payment SQL schemas
are version-dependent. Do not confuse SQL **incoming invoices** with outgoing
payment requests. `lncli listpayments` is the portable supported interface.

Verified against LND tag **v0.21.4-beta**:

- [`cmd/commands/cmd_payments.go`, lines 1431–1532](https://github.com/lightningnetwork/lnd/blob/v0.21.4-beta/cmd/commands/cmd_payments.go#L1431-L1532): CLI flags `include_incomplete`, `max_payments`, `index_offset`, `paginate_forwards`, and `creation_date_start`; forwards pagination uses `last_index_offset`. Default direction is reverse.
- [`rpcserver.go`, lines 6981–7045](https://github.com/lightningnetwork/lnd/blob/v0.21.4-beta/rpcserver.go#L6981-L7045): `max_payments=0` selects the database default rather than all records. Date bounds are passed in Unix seconds.
- [`lnrpc/lightning.proto`, lines 4293–4472](https://github.com/lightningnetwork/lnd/blob/v0.21.4-beta/lnrpc/lightning.proto#L4293-L4472): outgoing `Payment` exposes `payment_request`, payment-level `status`, and `creation_time_ns` (JSON int64 values are strings). `SUCCEEDED` / `FAILED` are distinct from per-HTLC attempt status; IN_FLIGHT / INITIATED are excluded. The same range defines pagination and date filters.

The short UI command enables `include_incomplete` (necessary for failures), explicitly
requests all matching records, sets the creation lower bound, and uses `jq -r` to
emit only payment requests with the selected **payment-level** status. Empty/missing
requests and non-BOLT11 requests are skipped. Connection/network flags belong before
`listpayments`. Check `lncli listpayments --help` on older releases.

The short recipe requests the maximum `uint64` record count to avoid default page
truncation, but very large responses can hit RPC size or memory limits. The collapsed
paginated recipe uses 500 records per call,
**forwards pagination**, and `last_index_offset`. It deliberately fetches all statuses
and filters time/status **locally**, so an empty raw page means end of history.
Never stop merely because a page contains no _matching_ invoices. It validates that
the cursor advances and propagates CLI/jq errors via `set -euo pipefail`. Any failure
can leave a partial text file; rerun successfully before importing it.

Both short and paginated recipes are generated from `export-queries.js`. The tests
execute their actual Bash/jq with a fake lncli; no LND node was available, so live
node behavior is not claimed to have been tested.

## Limits of equivalence

- CLN has hash/group/part records; LND has payment-level objects with attempts. These
  are not identical historical models, especially after retries or deleted records.
- CLN's cutoff is strict `>` and computed by PostgreSQL. LND's RPC lower bound is
  inclusive `>=` in whole Unix seconds; GNU/BSD `date` computes calendar-month
  lookbacks on the node. Month-end normalization and time zones can differ. For
  exact comparisons, choose an explicit common Unix cutoff and matching operators.
- Windows refer to payment creation, **not completion**, and not invoice creation.
  Charts continue to use the BOLT11-encoded invoice timestamp.
- Invoices alone contain no payment outcome; exporting a set does not turn this
  dashboard into a payment ledger. Deleted history cannot be reconstructed.
- These are read-only, non-transactional histories, not a live synchronized monitor.
  Keep exports private: BOLT11 invoices can expose descriptions and destinations.
