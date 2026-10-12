# Local remediation review — 12 October 2026

This report originally covered local review. After owner authorization, source was pushed and Cloudflare Pages deployed it. On 2026-10-12 the payment-integrity migration was applied to the production payment-portal Supabase project to restore service. Live staff sign-in, session verification and logout returned 200. Counts and a checksum of all original invoice fields matched before/after: 290 links, 206 paid and 84 pending. No real payment or email was submitted during this verification. Historical local-only statements below describe the initial review rather than the subsequent production repair.

## Review the result

- [Customer checkout](http://127.0.0.1:5176/pay/00000000-0000-4000-8000-000000000001)
- [Staff workflow](http://127.0.0.1:5176/)
- [Processing outcome](http://127.0.0.1:5176/pay/00000000-0000-4000-8000-000000000003)
- [Expired link](http://127.0.0.1:5176/pay/00000000-0000-4000-8000-000000000004)
- [Email failure example](http://127.0.0.1:5176/?email=failed)
- [Mobile WebKit screenshot](/Users/onp/Projects/payment-portal/.preview/mobile-webkit-393.png)
- [Desktop screenshot](/Users/onp/Projects/payment-portal/.preview/checkout-1440.png)

The server binds to localhost only and uses synthetic invoices/sessions/card selection/delivery outcomes. No payment, email, database or AI service is contacted. Start it again with `npm run build && npm run demo` if needed. The browser-control connector was unavailable, so the preview could not be opened automatically in a visible browser; the links above work locally.

## Requested mobile and cardholder changes

- Security code stays within the form at 320, 375, 390/393 and 430px. Narrow screens stack expiration and security code. Native input/grid minimum widths are bounded, so the password field cannot stretch its column beyond the form.
- Separate required **Name on card**, with `cc-name` autofill and accessible inline validation. It is not prefilled from the invoice customer, and a different name is accepted.
- The server validates the name independently (1–30 characters) and passes it as CardPointe `name`. The portal does not persist/log this name. The provider does not document issuer name-match verification; the field supplies account information, not proof of identity.

## What changed

Payment claims and finalization now live in service-only transactional PostgreSQL functions. One active attempt per payment link prevents cross-client races. Only a definite declined authorization unlocks retry; unknown outcomes, partial approvals and uncertain capture remain blocked for reconciliation. The amount displayed/authorized by the customer must match the database exactly, and only the canonical amount goes to the gateway. Authorization and capture are separate, and a full capture must be confirmed before the invoice becomes paid.

Pages Functions and the standalone Worker share one backend, eliminating their divergent security/payment/parser logic. Sessions fail closed, expire after an hour, use HttpOnly/SameSite cookies and durable hashed-IP login rate limits. No reusable staff passcode remains in localStorage.

Staff workflow rejects duplicate/mixed/incomplete batches, preserves manual corrections, resets billing after removing all files, and requires an explicit final review. Readable files can be attached after manual review when parsing fails. Requests/files/pages/image area/attachments have limits; PDF.js and its matching worker are bundled and patched. Stable creation request IDs make lost-response retries recover the existing link. Failed customer email is shown separately from successful link creation.

Customer UI validates complete lookup data, resets on invoice navigation, replaces blank routes with support guidance, handles pending payments without a new Pay action, announces completion and focuses the receipt. Paid date, safe card last four and print/save support are available. Receipt copy reports acceptance accurately and does not promise a message that was never sent. Contrast, mobile density, input bounds and static/API security headers were improved.

## Audit status

“Fixed locally” means implemented and checked in this workspace; it does **not** mean the live website or database changed. Database-backed guarantees require the reviewed migration and new environment configuration before release.

| Audit # | Finding | Current status |
| --- | --- | --- |
| 1 | Concurrent duplicate charges | Fixed locally: atomic invoice-row claim + unique active attempt; real isolated SQL race checked |
| 2 | Unsafe timeout/post-capture retry | Fixed locally: durable unknown state, no new charge, inquiry can finalize confirmed capture |
| 3 | Staff authorization fail-open | Fixed locally: missing configuration/session denies access |
| 4 | Amount validation/source | Fixed locally: exact cents, positive bounds, displayed amount agreement, canonical gateway amount |
| 5 | Partial/malformed approval | Fixed locally: authorize first, validate amount/reference, explicit confirmed capture |
| 6 | Expiry/terminal statuses | Fixed locally: reject cancelled/expired/nonpending links; paid receipts remain readable |
| 7 | Raw response/log leaks | Fixed locally: allowlisted data, controlled errors, safe correlation IDs; no provider/model dumps |
| 8 | Persistent shared credential | Partially addressed: expiring HttpOnly sessions + durable throttle; individual SSO/MFA still requires identity/Access configuration |
| 9 | Unvalidated AI fields | Fixed locally: exact type/sign/currency/length/email validation; no character-repair of invalid money |
| 10 | Partial/contradictory parse “success” | Fixed locally: partial/manual review; zero/negative/ambiguous balances not silently replaced |
| 11 | Mixed recipients/attachments | Fixed locally: known customer conflicts block the batch; explicit review for manual/partial files |
| 12 | Duplicate upload totals | Fixed locally: file/content/invoice duplicate checks; exact derived totals |
| 13 | Submission during scanning | Fixed locally: incomplete batch gates submission; intake locked during creation/recovery |
| 14 | Lost edits/stale removed fields | Fixed locally: derived defaults + explicit overrides, final-removal reset, obsolete results ignored |
| 15 | Email HTML injection | Fixed locally: escaped text/attributes, plain text alternative, validated canonical origin |
| 16 | Lost/duplicate creation response | Fixed locally: durable request identity, same-request replay/conflict handling and authenticated recovery lookup |
| 17 | Vulnerable CDN PDF.js | Fixed locally: maintained pinned 6.4.299 + matching bundled worker, eval disabled |
| 18 | Unbounded operations/resources | Fixed locally: request/body/upstream/file deadlines and file/page/area/attachment limits; real AI service runtime not exercised |
| 19 | HTTP failures authenticate staff UI | Fixed locally: explicit successful session response required; HTTP-500 browser test passed |
| 20 | Missing promised customer receipt | Fixed locally: customer receipt acceptance on completed/reconciled payment, truthful fallback; live delivery/bounce/queue operations remain external |
| 21 | Hidden email failure | Fixed locally: distinct accepted/failed/not-requested result and preserved invoice/recipient summary; full resend/history UI remains a separate feature |
| 22 | Stale paid route state | Fixed locally: invoice-keyed page + stale lookup cancellation |
| 23 | Null/malformed lookup crash | Fixed locally: full shape/status/amount/ID validation before render |
| 24 | Tokenizer protocol/retry | Fixed locally: documented blur protocol, exact origin/source, stale token invalidation, frame replacement and bounded loading; real UAT integration still required |
| 25 | Small-text contrast | Fixed locally: darker accent text |
| 26 | Completion focus/status | Fixed locally: live status, receipt heading focus, keyboard removal and print/save |
| 27 | Mobile density/long totals | Improved locally: compact mobile review and wrapping totals; necessary vertical scrolling remains |
| 28 | Scanned PDF/failed attachment | Fixed recovery locally: explicit manual-review attachment path; automated scanned-PDF OCR intentionally not added |
| 29 | Query/whole-row exposure | Fixed locally: validated UUIDs, encoded parameters, explicit select/output and no-store; anon table access revoked in prepared migration |
| 30 | Missing security headers | Fixed locally in static/function responses; real production CSP/HTTPS behavior must be verified after approval |
| 31 | Blank unknown routes | Fixed locally: unavailable-link/support fallback |
| 32 | Dependency advisories | Fixed locally: compatible updates; npm audit reports zero advisories |
| 33 | Generated-file lint failure | Fixed locally: root/Worker Wrangler caches ignored; all application/server/test source still linted |
| 34 | Config/docs/mock drift | Fixed locally: pinned tooling, clear dev/watch/demo commands, secret examples/ignore rules, mock approval disabled, current contracts and release prerequisites |

## Verification

- `npm test`: 16 passing checks, including canonical/displayed amount, separate cardholder forwarding, partial approval, post-capture failure/retry, later reconciliation/receipt, auth, creation replay, batch and preview behavior.
- `npm run test:db`: fresh socket-only PostgreSQL cluster, migration applied twice, 12 concurrent clients produce one attempt, unknown/paid replay protected, service-only grants, mixed-window throttles and creation replay verified. The cluster was destroyed; existing/remote databases were not contacted.
- `npm run lint`: passed.
- `npm run build`: passed; PDF library/worker are lazy-loaded for invoice intake.
- `npm audit`: zero advisories reported (not a guarantee of no vulnerabilities).
- Pages Functions compiled successfully with the pinned Wrangler.
- Headless Chrome: input containment at 320/375/390/393/430/768/1024/1440; different cardholder name, receipt focus, unavailable/pending routes, duplicate prevention, preserved edits, removal reset, failed-email feedback, rejected server-error login, and real bundled PDF extraction using a synthetic PDF.
- Headless WebKit: CVV/name field containment at 320/375/393/430 and 200% text. This is WebKit engine testing, not a physical iPhone certification.
- Screenshots contain only sample data. No raw card numbers, real CVV, payment tokens or credentials were captured.

## Before any push/deployment approval

1. Review [the migration](/Users/onp/Projects/payment-portal/supabase/migrations/202610120001_payment_integrity.sql) against the actual schema and consumers. It adds expiry/attempts/creation identity/notification state/masked last four, enables link-table RLS and revokes anon/authenticated direct access. Do not apply blindly to another app sharing the table. Existing invalid/duplicate records require inspection, not automatic deletion/merging.
2. Supply the documented environment settings and separate session secret in secret stores. No values were printed or changed here. Individual staff SSO remains unfinished deployment work.
3. Verify real UAT hosted tokenization, authorization/capture/decline/partial behavior, merchant fraud/AVS/CVV settings and settlement/reversal procedures.
4. Establish merchant reconciliation for unresolved/not-captured attempts. Do not release a claim from elapsed time alone, and do not roll back to the old unsafe charging path with unresolved attempts.
5. Verify actual email delivery, bounce handling and durable operational retries. Acceptance from the email API is not proof of delivery; notification idempotency/retention is provider-dependent.
6. Review the tracked invoice PDF for private data; it was not opened, used as a fixture or removed. Backups, existing grants, identity/edge rules and production logs remain unverified.

Optional wallets, international addresses, automatic scanned-PDF OCR, reminders, accounting sync, a full administration dashboard and broad product feature expansion were not added. The repair retains the existing merchant/provider and dependency-light UI.
