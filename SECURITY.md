# Security

## Reporting a vulnerability

Please do not publish working exploits, private invoices, or sensitive findings in a GitHub issue.
Send sensitive reports to **Johannes Zweng** using OpenPGP and an email address listed in the key's
valid user IDs.

```text
Fingerprint: 4A69 B9BF 6D00 2231 B3EA 6552 C6C0 09F4 9B46 AB71
Key:         https://johannes.zweng.at/C6C009F49B46AB71.asc
```

Verify the complete fingerprint before encrypting. Include the affected commit, browser version,
reproduction steps using synthetic or public data, expected versus actual behavior, and potential
impact. This volunteer project does not promise a response deadline, bounty, or independent
security audit.

Only the current default branch is maintained. Operators are responsible for updating deployed
copies.

## Threat model

Lightning Lens is a static invoice-analysis tool, not a wallet. It has no private keys, account,
application backend, or database and cannot initiate a payment.

Untrusted inputs include:

- pasted or imported BOLT11 invoices;
- invoice descriptions, route hints, feature fields, and fallback data;
- node aliases and other responses returned by the optional public-node API; and
- filenames and clipboard availability supplied by the browser.

Assets to protect are the user's browser and machine, invoice privacy, analysis integrity,
availability, clipboard contents, and exported files.

```text
invoice text
  → bounded normalization and BOLT11 structural decoding
  → compact records without descriptions or full invoices
  → exact aggregation
  → text-only DOM rendering / CSV export

confirmed public keys
  → bounded mempool.space request
  → typed and size-limited response
  → text-only DOM rendering
```

The hosting origin, browser, operating system, and application files are trusted. This design does
not protect against a compromised deployment serving malicious JavaScript, a malicious browser
extension, or a local attacker with the user's privileges.

## Security and privacy properties

### Input handling

- Raw and normalized invoice lengths, tag counts, and route-hop counts are bounded.
- Bech32 framing, checksum, amount encoding, fixed-size fields, and usable public keys are checked.
- Invalid lines are rejected independently; displayed errors are bounded in count and length.
- Mixed-case invoices are rejected before duplicate canonicalization.
- Descriptions and full invoice strings are discarded from compact analysis records.
- Signature verification is deliberately out of scope. Public-key recovery identifies the stated
  destination when no explicit `n` field exists; it is not an authenticity guarantee.

### Browser rendering and exports

- UI helpers create DOM text nodes instead of interpolating HTML.
- Node aliases are treated as untrusted text; control and bidi-formatting characters are removed.
- External links use fixed HTTPS hosts with `noopener`, `noreferrer`, and no referrer.
- CSV fields are always quoted, embedded quotes are escaped, and formula-leading text is
  neutralized.
- Generated CLN/LND recipes accept only fixed node/outcome choices and a validated month range.
  They do not contain invoice data or credentials.

### External requests

No request is made while decoding, filtering, sorting, charting, or exporting. The only application
API request is an explicit, confirmed lookup of selected mainnet public keys on `mempool.space`.
The client enforces:

- at most 64 distinct keys per page load;
- at most four concurrent requests;
- a nine-second timeout;
- no credentials or referrer;
- no redirects;
- a 64 KiB response limit; and
- a narrow, typed set of response fields.

Ordinary explorer links are opened only by the user. The static host still receives normal asset
requests and the user's IP address.

### Hosting

`public/index.html` includes a restrictive meta Content Security Policy for static hosts. The
sample [`deploy/nginx.conf`](deploy/nginx.conf) adds `frame-ancestors`, no-referrer, nosniff,
Permissions-Policy, frame denial, privacy-conscious logs, and same-origin worker restrictions.

Serve the application over HTTPS, deploy only `public/`, and review every reverse proxy or CDN in
front of nginx. A static application's privacy still depends on the exact files and headers served
by its host.

## Known limitations

- Structural BOLT11 decoding is not full protocol conformance or signature verification.
- Invoice data cannot prove payment completion, actual routing, fees, balances, or liquidity.
- Very large batches can exhaust browser memory despite per-invoice limits.
- Public node aliases are not identity proof, and a missing public-map entry does not prove a node
  is private.
- JavaScript cannot promise secure erasure from browser memory. Reloading removes application
  references but is not a forensic data-destruction guarantee.
