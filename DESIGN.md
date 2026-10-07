# Design and decisions

## Understanding

Build a client-only tool for operators with hundreds or thousands of BOLT11 invoices. Reveal destinations, advertised routing-entry alternatives, invoice anatomy, and amounts with low visual/cognitive overhead. Time-window interaction must update every view. Input never leaves the browser; public-node enrichment is bounded and explicitly opt-in. Signature verification and actual payment/route reconstruction are out of scope.

## Assumptions

- Input consists of one complete invoice per line; arbitrary batch count, limited by device memory.
- Time means invoice creation timestamp in UTC, not payment settlement time.
- Requested amounts cannot establish actual paid amounts; amountless invoices have unknown value.
- Exact duplicate strings are accidental unless the user explicitly includes them; payment hashes alone do not deduplicate distinct invoices.
- Real-hint targets are distinct first-node IDs per invoice. All distinct alternatives get attribution, so target totals are non-additive. With no real hints left, use the destination.
- The app should work on a static host and remain useful offline after assets have loaded. External lookup failure must not affect analysis.
- No persistence or backend; ongoing maintenance uses dependency-free JavaScript and Node's built-in test runner.

## Data flow

Text → worker → normalized/checksummed/tag-decoded invoices → compact records with multiplicity → main thread inclusive time/network selection → BigInt aggregation → bounded chart/table rendering. `app.js` coordinates the lifecycle, `analysis.js` owns batch decoding, `statistics.js` owns pure calculations, and `ui/dashboard.js` renders linked views. Worker progress uses elapsed-time chunks; cancel terminates it. Rejected lines have bounded samples and exact counts. Filtering never redoes cryptographic recovery. Table state persists across filter changes; pages are clamped to available rows.

Optional manual lookup → confirmed selected mainnet keys → cached/queued bounded fetch → typed/sanitized public-node fields → text-only aliases and CSV enrichment. No chart render, table sort, or filter event initiates a request.

## Key risks and tests

Identity extraction isn't signature authenticity. Invoice attribution isn't evidence of payment. Route alternatives overlap. Missing public-node data isn't evidence of privacy. Per-invoice safeguards can reject extreme protocol encodings. Massive batches can exceed browser memory; there is no promise of unbounded memory.

Test official BOLT11 vectors, real Spark data, checksum/encoding failures, pure recovery versus explicit keys, alternate-route attribution, Spark-only fallback, amount boundaries, zero and amountless values, inclusive time/network isolation, duplicate weights, CSV/formula and alias sanitization, bounded external responses/concurrency/cache, and the private sibling fixture. Browser tests cover worker progress, filtering, tables, mobile layout, no implicit remote requests, and malformed input behavior.
