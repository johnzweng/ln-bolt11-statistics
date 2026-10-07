# Contributing

Thanks for helping make Lightning Lens useful to Lightning node operators. Small, focused
improvements, bug reports, documentation, and additional protocol vectors are welcome.

## Get started

1. Install Node.js 22 or newer (CI tests 22 and 24). No package installation or build step is needed.
2. Run `npm run dev` and open <http://localhost:4173>.
3. Use **Explore a demo** or public test vectors rather than private payment exports.
4. Before submitting a change, run:

   ```sh
   npm run check
   npm test
   git diff --check
   ```

`npm run check` checks JavaScript syntax, including browser-only modules that Node tests do not
import. It is not a linter or type checker. Tests use Node's built-in runner; the CLN recipe tests
use its SQLite module, which may emit an experimental warning on some Node releases.

**Install Bash and jq to run all export tests.** The LND recipe tests execute generated commands
against a fake `lncli`, not a real node. Without jq, those tests are skipped; inspect the test
summary rather than treating skipped tests as full validation. CI requires these tools and checks
syntax and tests on Node 22 and 24. A separate CI job runs the browser regression suite on Node 24
with the Ubuntu runner's headless Chrome in a disposable profile. On failure, it uploads screenshots
and server/browser logs for seven days; only public or synthetic test data is used.

For a focused test run:

```sh
node --test test/statistics.test.js
node --test test/network.test.js
node --test test/ui-data.test.js
node --test test/server.test.js
```

UI changes should also run `npm run test:browser` with the development server and an isolated
debug Chrome running, as described in [README.md](README.md#tests). That suite covers worker
decoding, filters, floating time controls, tables, exports, responsive layouts, and absence of
implicit external requests. Screenshots are written to ignored `artifacts/`.

The optional `npm run test:real -- /path/to/fixture.csv` needs a private fixture with simple,
unquoted columns and a `bolt11` header. It is not required for contributions. Never commit that
fixture or attach it to a public issue.

## Find the right module

Read [DESIGN.md](DESIGN.md) for invoice semantics and the data flow.

| Change | Start here |
| --- | --- |
| Input normalization and resource safeguards | `public/assets/bolt11/input.js` |
| BOLT11 fields and destination recovery | `public/assets/bolt11/bolt11.js` |
| Spark identity markers | `public/assets/bolt11/spark.js` |
| Batch decoding, duplicates, compact records, progress | `public/assets/analysis.js` |
| Amounts, attribution, categories, filters, time bins | `public/assets/statistics.js` |
| Input actions, worker lifecycle, linked time controls | `public/assets/app.js` |
| Dashboard views and charts | `public/assets/ui/dashboard.js`, `charts.js` |
| Node rankings, sortable tables, CSV | `public/assets/ui/node-panel.js`, `node-table.js` |
| Optional bounded public-node requests | `public/assets/ui/node-lookup.js` |
| Node export recipes | `public/assets/ui/export-queries.js` and [export semantics](docs/payment-exports.md) |
| Local development server | `scripts/static-server.js` (`serve.js` starts it) and `test/server.test.js` |
| Static deployment and headers | [`deploy/`](deploy/README.md) |

Keep calculations independent of the DOM, and keep rendering independent of network requests.
The worker protocol lives in `worker.js` and `app.js`; change and test both ends together.
`analysis.js` re-exports the statistics API for scripts; keep those exports working.

## Preserve the important contracts

- Keep the project dependency-free and deployable as `public/`, without a build step.
- Analysis is local and ephemeral. Never add implicit requests, persistence, analytics, or remote
  assets. Node enrichment must remain manual, confirmed, mainnet-only, and bounded.
- Keep amounts as exact `BigInt` millisatoshis through aggregation and CSV. Number conversions
  are for chart ratios, not monetary calculations.
- Time boundaries are inclusive UTC invoice-creation timestamps. Networks must remain separate.
- Exact normalized invoice strings are deduplicated; different strings sharing a payment hash
  are retained. Including duplicate copies changes statistical weights, not the unique count.
- Route-hint alternatives are non-additive attributions. Spark identity markers are not routes.
  No usable hint means attribution falls back to the destination.
- Destination recovery is not signature verification. The dashboard cannot prove payment
  completion, fees, actual routes, or spendable liquidity.
- Treat invoice fields and public-node aliases as untrusted. Use text-only DOM helpers and the
  existing label/CSV safeguards rather than HTML interpolation.
- Known-node labels need a primary source. Do not infer identity from an alias or a Spark marker.

Prefer characterization tests before refactoring. Preserve output formats, error messages, and
public exports; propose intentional behavioral changes separately. Follow `.editorconfig` and
the existing explicit ES-module style. Avoid repository-wide formatting and speculative abstractions.

## Issues and pull requests

For a bug report, include the browser/Node version, reproduction steps with synthetic or public
data, and expected versus actual behavior. For a PR, explain what changed, why, which checks ran,
and any remaining risk. Update documentation when changing a contract or contributor command.

Do not share private invoices, descriptions, payment hashes, preimages, credentials, or exports
in issues, logs, screenshots, or test fixtures. Report vulnerabilities through
[SECURITY.md](SECURITY.md), not a public issue.
