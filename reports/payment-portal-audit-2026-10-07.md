# Payment portal audit — 7 October 2026

**Update — 12 October:** Local remediation is available for review in [the remediation report](/Users/onp/Projects/payment-portal/reports/payment-portal-remediation-2026-10-12.md). The findings and source locations below describe the original pre-fix review; the live deployment has not been changed.

The largest risks are payment correctness and recovery, followed by staff access and invoice accuracy. Cosmetic changes should follow those fixes.

This review found **34 actionable issues**, plus deployment checks and optional feature improvements. P0 means fix before relying on the affected production flow; P1 means fix next; P2 means improve reliability, usability, accessibility, or maintenance. Feature proposals are not requirements or confirmed defects.

## Scope and confidence

- Reviewed the current working tree, including existing uncommitted UI changes, all frontend components, four Pages Functions, the standalone Worker, configuration, README, constitution, and current Spec Kit artifacts.
- Ran lint, build, dependency audits, synthetic backend reproductions, and headless Chrome checks at 375×812, 768×900, 1024×900, and 1440×900.
- Stubbed all payment, database, email, and invoice-analysis requests in the reproductions. No real charges, emails, customer records, or secret values were used. Hosted-card behavior was represented by a synthetic iframe; real provider integration was not certified.
- Made two read-only public requests to the deployed root and the payment-link endpoint without an ID, to inspect response headers. Findings about local code do not prove which revision is deployed.
- Did not inspect live Supabase schema/RLS, deployment secrets, merchant fraud settings, financial settlement, email delivery, production logs, or customer invoices. These remain explicit verification items below.
- Application source was not changed. This report is an audit, not an implementation or production security certification.

## P0 — payment and access blockers

### 1. Concurrent requests can charge the same invoice twice

**Evidence:** [Pages charge check](/Users/onp/Projects/payment-portal/functions/charge.js:83), [gateway request](/Users/onp/Projects/payment-portal/functions/charge.js:130), and [Worker equivalent](/Users/onp/Projects/payment-portal/worker/src/index.js:416). Both handlers read `pending`, charge, and only then mark the invoice paid. The frontend lock covers only one mounted form.

**Reproduced:** Two simultaneous calls against the same synthetic pending invoice made two gateway calls. A second tab, second browser, or direct API retry bypasses the UI lock.

**Fix:** Atomically claim the invoice/attempt in the database before charging, give the attempt a durable identity, and enforce one active attempt per invoice. Verify the gateway's documented duplicate/recovery semantics rather than assuming an order ID alone provides idempotency. Repeated requests should return the existing attempt's state.

**Acceptance:** Concurrent submissions from separate clients produce one financial transaction; a replay returns the same outcome.

### 2. A captured payment can be presented as a retryable failure

**Evidence:** [Database update failure](/Users/onp/Projects/payment-portal/functions/charge.js:176), [generic 5xx mapping](/Users/onp/Projects/payment-portal/src/components/PaymentForm.jsx:48), [charge timeout recovery](/Users/onp/Projects/payment-portal/src/components/PaymentForm.jsx:243), and [current frontend contract](/Users/onp/Projects/payment-portal/specs/001-payment-ui-hardening/contracts/frontend-boundaries.md).

**Reproduced:** After synthetic gateway approval, a failed database PATCH returned 500. Retrying the unchanged pending invoice made another gateway call. Aborting the browser's fetch does not establish that server processing or the gateway charge stopped.

**Fix:** Persist and reconcile the financial attempt independently of the page. Treat timeout, lost response, and post-charge write failure as an unknown/processing outcome. Check the existing attempt before enabling another charge; show support guidance when reconciliation is needed. Update the contract/spec that currently encourages retry after these failures.

**Acceptance:** Lose the response or fail the database write after approval; the customer gets a recoverable status, and retry cannot charge again.

### 3. Staff authorization fails open when configuration is missing

**Evidence:** [Link creation](/Users/onp/Projects/payment-portal/functions/create-link.js:10), [invoice analysis](/Users/onp/Projects/payment-portal/functions/analyze-invoice.js:151), and [Worker staff routes](/Users/onp/Projects/payment-portal/worker/src/index.js:65) enforce authorization only when `STAFF_PASSCODE` is truthy.

**Reproduced:** With no staff passcode configured, a synthetic unauthenticated create-link request succeeded. Invoice analysis has the same guard.

**Fix:** Reject staff requests when authorization configuration is absent. Validate required deployment configuration before making the staff workflow available. The UI login screen is not an authorization boundary.

**Acceptance:** Missing configuration and missing/wrong credentials cannot create links, send invoice emails, or use AI analysis.

## P1 — security, financial correctness, and workflow integrity

### 4. The gateway receives the client-supplied amount

**Evidence:** [Amount comparison](/Users/onp/Projects/payment-portal/functions/charge.js:93), [gateway amount](/Users/onp/Projects/payment-portal/functions/charge.js:122), [create-link validation](/Users/onp/Projects/payment-portal/functions/create-link.js:19), and corresponding Worker paths.

**Reproduced:** A `9.99` request for a `10.00` invoice passed the tolerance check and reached the gateway unchanged. A nonnumeric string also passed because the comparison evaluates against `NaN`. Negative amounts and invalid email addresses passed create-link's presence checks under a mocked database.

**Fix:** Validate types, complete decimal syntax, positive bounds, currency, and precision on the server. Use exact cents or an equivalent exact decimal representation. Derive the charged amount from the verified invoice, not the request. Validate invoice/customer fields, email, and lengths before insertion or delivery.

**Acceptance:** Nonnumeric, nonfinite, negative, zero, oversized, partially numeric, and extra-precision amounts are rejected; the gateway always gets the exact canonical invoice amount.

### 5. Any approval marks the full invoice paid

**Evidence:** [Approval handling](/Users/onp/Projects/payment-portal/functions/charge.js:149) and [Worker handling](/Users/onp/Projects/payment-portal/worker/src/index.js:484). Only `respstat === 'A'` is checked; the approved amount and reference are not validated.

**Reproduced:** A synthetic approval reporting half the invoice amount still marked the full invoice paid and returned success.

**Fix:** Validate the provider response contract, required reference, and approved amount against the attempt. Explicitly handle partial approvals and malformed responses. Define what the displayed paid status means for authorization, capture, and subsequent settlement/reversal.

**Acceptance:** Partial approval or missing reference cannot produce a full-payment receipt. Fiserv documents processor-dependent partial-approval response codes and transaction lifecycle states in its [gateway response reference](https://developer.fiserv.com/product/CardPointe/docs/changelog/CardPointeGatewayAPI.md/?path=docs%2Fdocumentation%2FGatewayResponseCodes.md).

### 6. Expiration and other terminal statuses are not enforced

**Evidence:** [Lookup](/Users/onp/Projects/payment-portal/functions/payment-link.js:36), [charge status guard](/Users/onp/Projects/payment-portal/functions/charge.js:85), and [customer status handling](/Users/onp/Projects/payment-portal/src/pages/PaymentPage.jsx:65). Only `paid` is distinguished; there is no application expiration check.

**Reproduced:** A synthetic record with an old `expires_at` remained chargeable. A `cancelled` record rendered a payable checkout.

**Fix:** Define explicit permitted statuses and expiry semantics, enforce them in lookup and charge, and expose appropriate unavailable/processing/paid states. Add schema changes only after inspecting the existing database. Make revocation possible for a mistaken link.

**Acceptance:** Expired, cancelled, revoked, or otherwise nonpayable records cannot be charged, including through direct API calls.

### 7. Backend responses and logs expose raw upstream content

**Evidence:** [Database error details](/Users/onp/Projects/payment-portal/functions/create-link.js:46), [lookup details](/Users/onp/Projects/payment-portal/functions/payment-link.js:28), [model logging](/Users/onp/Projects/payment-portal/functions/analyze-invoice.js:133), [model response echo](/Users/onp/Projects/payment-portal/functions/analyze-invoice.js:251), [Worker exception output](/Users/onp/Projects/payment-portal/worker/src/index.js:91), and [gateway error logging](/Users/onp/Projects/payment-portal/worker/src/index.js:472).

**Risk:** The frontend hides several raw errors, but direct API callers still receive them. Model output can contain invoice/customer content; upstream errors may contain sensitive information. No production leak was observed or tested.

**Fix:** Use controlled public error codes/messages and redacted operational diagnostics. Never dump provider bodies, model output, request bodies, or exception objects that can carry customer or payment data. Include a safe correlation ID for support.

**Acceptance:** Force malformed AI output, database failure, gateway failure, and exceptions; returned JSON and captured logs contain only approved diagnostic fields.

### 8. Staff access uses a persistent shared secret without an application session

**Evidence:** [Local storage credential](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:135), [credential persistence](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:337), and staff request headers. No application session expiry, individual identity, or attempt throttling exists in the reviewed code.

**Risk:** Any same-origin script can read the shared credential. Access cannot be revoked for one staff member or attributed to an individual. Edge-level throttling/access controls are unverified.

**Fix:** Prefer the existing identity platform or Cloudflare Access with server-side identity verification, short-lived sessions, individual accounts, and appropriate throttling. Remove persistent browser storage of the reusable staff secret.

**Acceptance:** Expired/revoked access fails server-side; logout clears workflow data; staff actions have a nonsecret actor identity; automated login attempts are limited.

### 9. AI invoice fields are normalized instead of validated

**Evidence:** [AI parsing](/Users/onp/Projects/payment-portal/functions/analyze-invoice.js:127), [normalization](/Users/onp/Projects/payment-portal/functions/analyze-invoice.js:191), [image normalization](/Users/onp/Projects/payment-portal/functions/analyze-invoice.js:240), and Worker equivalents.

**Reproduced:** AI amount `-25.00` became `25.00`; an object name became `[object Object]`; an invalid email was accepted. Removing unwanted characters can turn incorrect data into plausible billing data.

**Fix:** Validate object shape, field types, maximum lengths, exact amount syntax, sign, currency, and email. Reject malformed values rather than repairing them silently. Treat instruction-like invoice content as untrusted and require staff review of uncertain financial fields.

**Acceptance:** Wrong types, arrays, negative amounts, multiple decimal points, invalid emails, and instruction-bearing model output cannot become a verified invoice.

### 10. Partial or contradictory parsing is shown as successful

**Evidence:** [Deterministic parser success condition](/Users/onp/Projects/payment-portal/functions/analyze-invoice.js:167), [TOTAL fallback](/Users/onp/Projects/payment-portal/functions/analyze-invoice.js:106), and [frontend success assignment](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:294).

**Reproduced:** Text containing negative `AMOUNT DUE` and positive `TOTAL` returned the positive total. Even an empty/partial object can get a successful invoice row in the UI.

**Fix:** Distinguish complete, partial, unreadable, and contradictory results. Preserve whether an amount came from amount due or total; do not silently substitute total when there may be deposits, credits, or a zero balance. Require review of missing/conflicting fields.

**Acceptance:** Deposits, credits, zero due, partial fields, and alternative layouts never silently generate an incorrect payable balance.

### 11. Different customers' invoices can be combined and emailed together

**Evidence:** [First-customer selection](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:187), [attachments collection](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:451), and [warning-only mismatch handling](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:635).

**Risk:** The total includes all successful invoices, customer details come from selected first matches, and all successful attachments go to that one recipient. A warning does not prevent billing the wrong customer or sharing another customer's invoice.

**Fix:** Block mixed-customer batches by default or group them into separate recipient workflows. Any deliberate consolidation needs an explicit recipient/invoice review. Include company/account identity in matching where relevant.

**Acceptance:** Two different recipients cannot accidentally produce one combined emailed invoice request.

### 12. Duplicate uploads inflate the total while hiding duplicate invoice numbers

**Evidence:** [Unique displayed invoice numbers](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:173), [sum of all amounts](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:179), and unrestricted repeat upload.

**Reproduced:** Uploading the same synthetic invoice twice displayed one invoice number but increased the amount from `10.00` to `20.00`.

**Fix:** Detect repeat uploads/invoice identities, flag conflicting versions, and let staff deliberately replace or keep a file. Sum only reviewed, intended invoices, using exact money arithmetic.

**Acceptance:** Uploading a duplicate cannot silently increase the payable balance.

### 13. Link generation remains available while invoice analysis is unfinished

**Evidence:** [Parallel file processing](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:414), [attachment selection](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:451), and [button disabling](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:783), which considers submission loading but not scanning.

**Reproduced:** With a scan still showing “Reading invoice,” Generate link remained enabled. Upload/removal controls also remain active during link creation.

**Fix:** Prevent submission while the chosen invoice batch is incomplete, or require an explicit decision to exclude unfinished/failed files. Freeze the reviewed batch during submission and cancel or disregard obsolete parsing work.

**Acceptance:** The recipient, amount, invoice numbers, and attachments submitted all describe the same finalized batch.

### 14. Automatic consolidation overwrites manual corrections and leaves stale fields

**Evidence:** [Consolidation effect](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:167). It rewrites fields whenever invoice state changes, but returns immediately when no successful invoice remains. Missing name/company/email values are not cleared.

**Reproduced:** A scan replaced a manually corrected name. Removing every uploaded file left an old invoice number and amount in the form.

**Fix:** Preserve explicitly edited fields, update derived totals only from the active reviewed batch, and clear or ask how to retain values when removing the batch. Do not carry one customer's company/email into another customer's invoice.

**Acceptance:** Background scans cannot silently undo corrections; removing/replacing all invoices cannot leave unnoticed stale billing data.

### 15. User-controlled values are inserted into email HTML unescaped

**Evidence:** [Customer email template](/Users/onp/Projects/payment-portal/functions/create-link.js:78), [staff payment template](/Users/onp/Projects/payment-portal/functions/charge.js:210), and Worker templates.

**Reproduced:** A synthetic HTML marker in the customer name appeared as markup in the composed email. This proves HTML injection, not JavaScript execution in a mail client.

**Fix:** Escape all text and attribute values, validate addresses and invoice fields, and include a plain-text alternative. Use an explicitly configured canonical payment origin.

**Acceptance:** Names or invoice identifiers containing quotes, angle brackets, and ampersands render as literal text and cannot change email links/content.

### 16. Link creation can lose a created record and duplicate it on retry

**Evidence:** [Insert before email](/Users/onp/Projects/payment-portal/functions/create-link.js:28), [email request](/Users/onp/Projects/payment-portal/functions/create-link.js:143), and [frontend retry handling](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:480). There is no request-level creation identity or recovery lookup in the reviewed application.

**Risk:** An email fetch exception or lost response can occur after the record was inserted. Staff get a generic failure and may submit again. Existing database uniqueness constraints were not inspected.

**Fix:** Make creation recoverable/idempotent for a reviewed request, return the created link even if delivery fails, and retry email delivery independently. Persist creation/delivery states sufficient for recovery.

**Acceptance:** Failure after insertion preserves a discoverable link; retry returns it rather than creating another billing request.

### 17. PDF.js is loaded from a known vulnerable release

**Evidence:** [CDN script and worker](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:17) pin PDF.js `3.11.174`; [document loading](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:32) does not set `isEvalSupported: false`.

**Risk:** Mozilla identifies versions through `4.1.392` as affected by CVE-2024-4367, with `4.2.67` as the first patched release and disabling eval as a workaround. The advisory's exploitation requires the affected execution path; exploitation through this app's text-only extraction was not demonstrated. This CDN dependency is outside the package-lock dependency audit. See [Mozilla's advisory](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq).

**Fix:** Upgrade to a maintained patched release with a matching worker, use safe document-loading settings, and make the dependency version reproducible. Prefer a bundled dependency over an uncontrolled runtime script where practical.

**Acceptance:** The staff origin no longer loads the affected release; representative PDFs still extract correctly, including malformed-file handling.

### 18. Requests and uploads have incomplete resource bounds

**Evidence:** [Unbounded file reads/base64](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:239), [staff fetches](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:270), [charge timer cleanup before body parsing](/Users/onp/Projects/payment-portal/src/components/PaymentForm.jsx:217), and server-side fetches without explicit deadlines throughout both backends.

**Risk:** Login, scans, and link generation can stay busy indefinitely. Charge's timer stops when headers arrive, leaving body reads outside its deadline. Large/unlimited files are held in multiple representations and can cause memory pressure, oversized email payloads, or expensive AI calls. Image resizing limits width, not total pixel area.

**Fix:** Define file count, byte, page, pixel, attachment, and request-body limits; validate them at trust boundaries. Bound the entire fetch/body operation and server upstream calls. Provide cancellation and safe recovery. Payment timeouts must follow issue 2's unknown-outcome handling.

**Acceptance:** Hung headers/body, slow CDN loading, oversized/tall images, large PDFs, and excessive files terminate predictably without enabling an unsafe payment retry.

## P2 — functionality, customer experience, accessibility, and delivery

### 19. Staff login treats almost every HTTP response as valid authentication

**Evidence:** [Passcode verification](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:317) rejects only 401, then saves the passcode for any other response.

**Reproduced:** A synthetic HTML HTTP 500 response opened the staff workspace. This UI bug does not bypass a correctly configured backend guard, but gives false confidence and stores an unverified credential.

**Fix:** Verify through an explicit authentication/session response; reject server failures, HTML, unexpected statuses, and malformed responses.

### 20. The receipt promises a customer confirmation email that is not sent by this code

**Evidence:** [Receipt promise](/Users/onp/Projects/payment-portal/src/pages/PaymentPage.jsx:184) versus [charge email recipients](/Users/onp/Projects/payment-portal/functions/charge.js:206). Both charge implementations send an internal staff alert only.

**Fix:** Send a customer receipt from a durable successful-payment event, with retry/delivery tracking, or change the promise to match actual behavior. A gateway's independently configured receipt service was not verified.

**Acceptance:** The customer receives one receipt or is accurately told how to obtain it.

### 21. Email failure is hidden behind a generic success message

**Evidence:** [Email result handling](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:486), [success message](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:681), and form reset after generation.

**Reproduced:** Choosing Generate & send email with `email_sent: false` produced a green success box saying to copy the link manually, without explicitly saying delivery failed.

**Fix:** Separate link-created and email-accepted/failed states. Keep a recipient/invoice summary, provide resend against the existing link, and retain the provider message ID where appropriate. Provider acceptance should not be labeled customer delivery.

### 22. Paid state survives navigation to a different unpaid invoice

**Evidence:** [Local paid state](/Users/onp/Projects/payment-portal/src/pages/PaymentPage.jsx:36) is set for paid links but not reset when the route ID changes.

**Reproduced:** Client-side navigation from a paid link to a pending link showed Payment received and no payment form for the new invoice.

**Fix:** Reset invoice-specific state on route changes or key the page by invoice ID. Ignore superseded lookup responses and cleanup-triggered errors so an old request cannot update a new invoice view.

### 23. Frontend invoice validation can show zero-dollar checkout or crash the page

**Evidence:** [Lookup validation](/Users/onp/Projects/payment-portal/src/pages/PaymentPage.jsx:60), [name parsing](/Users/onp/Projects/payment-portal/src/pages/PaymentPage.jsx:13), and number coercion.

**Reproduced:** `amount: null` displayed Pay $0.00; an object customer name caused a blank page. Unknown status values also reached the form (issue 6).

**Fix:** Validate the complete public response shape before rendering: ID, invoice string, positive amount, supported currency/status, and customer/reference types. Fail safely for malformed data and add a useful route-level error fallback.

### 24. Hosted-card loading and tokenizer retry behavior need stronger recovery

**Evidence:** [Iframe readiness](/Users/onp/Projects/payment-portal/src/components/PaymentForm.jsx:269), [pending token handling](/Users/onp/Projects/payment-portal/src/components/PaymentForm.jsx:95), and [two tokenize messages](/Users/onp/Projects/payment-portal/src/components/PaymentForm.jsx:170).

**Finding:** Initial iframe loading has no deadline or reload action. `onLoad` is treated as readiness even if the provider returned an error document. A late message from an earlier timed-out attempt can resolve a newer pending attempt, because the same iframe/window is reused without an attempt distinction. This retry race was identified by inspection, not live-provider reproduction.

**Fix:** Follow one documented provider message protocol, validate token type/shape, trust the exact configured origin/source, and reset the frame after timeout if the protocol cannot identify attempts. Add bounded initialization/reload and focus the hosted field after a card-number failure. Settle/cancel pending work on unmount.

**Acceptance:** Blocked loading, provider error pages, late messages during a retry, and navigation do not leave a permanently disabled or ambiguous payment form.

### 25. Small accent text fails minimum contrast

**Evidence:** [Accent token](/Users/onp/Projects/payment-portal/src/index.css:13), [eyebrows](/Users/onp/Projects/payment-portal/src/index.css:144), and [step kickers](/Users/onp/Projects/payment-portal/src/index.css:193).

**Measured:** `#4e86b5` on white is about 3.89:1; on the muted surface about 3.68:1. These are 12px text styles, below the normal-text 4.5:1 threshold in [WCAG's contrast criterion](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html).

**Fix:** Use a darker semantic text color while retaining the lighter accent for decorative surfaces. Check input boundaries and all status/helper states separately.

### 26. Payment completion and processing need deliberate focus/status handling

**Evidence:** [Success handler](/Users/onp/Projects/payment-portal/src/pages/PaymentPage.jsx:89) scrolls only; [success heading](/Users/onp/Projects/payment-portal/src/pages/PaymentPage.jsx:153) has no focus transfer/live announcement; [processing button](/Users/onp/Projects/payment-portal/src/components/PaymentForm.jsx:347) changes inside a disabled control without a dedicated processing status region.

**Fix:** Announce processing and completion, move focus to the receipt heading when the form is replaced, and preserve logical focus after invoice removal/logout. Validate with a screen reader, not just DOM attributes. Keep current field-level labels, errors, visible focus, and keyboard upload behavior.

### 27. Mobile checkout makes customers scroll through substantial framing before entering payment

**Measured:** The synthetic checkout was approximately 1,588px tall at 375×812 and 1,290px at 768×900. The card-entry section began around/below the first mobile viewport. The empty staff workspace was about 1,201px at both 768 and 1024 widths. Normal amounts had no document-level horizontal overflow; desktop checkout and the 1440-wide staff view fit vertically.

**Fix:** Reduce duplicated trust/step copy, top padding, and excess field-error reservation where possible; keep invoice/amount review clear. Consider a compact invoice summary on narrow screens. Reassess the 1200px staff breakpoint using real laptop heights and zoom. Large amounts need grouping and wrapping rather than forcing the total label into a narrow column.

**Acceptance:** Check 320/375/390/768 widths, short laptop heights, browser zoom, on-screen keyboard, long customer data, and large amounts. Vertical scrolling is expected on mobile; the goal is a shorter, clearer path, not eliminating necessary scrolling.

### 28. Scanned PDFs have no OCR path and failed parsing prevents attachment inclusion

**Evidence:** [PDF text extraction request](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:262), [truthy text branch](/Users/onp/Projects/payment-portal/functions/analyze-invoice.js:168), and [successful-only attachments](/Users/onp/Projects/payment-portal/src/pages/CreateLink.jsx:451).

**Finding:** Image-only PDFs produce no text and are not rendered for OCR. A readable file whose parsing fails is also excluded from customer attachments, even if staff manually supply its billing details.

**Fix:** Clearly distinguish unsupported scanned PDF from unreadable file; allow manual entry with a reviewed readable attachment independently of extraction success. Add page-to-image OCR only if scanned PDFs are common enough to justify it. Provide per-file retry/remove and consistent supported-format/limit guidance.

### 29. Public lookup accepts arbitrary IDs and returns the whole database row

**Evidence:** [Service-role query construction](/Users/onp/Projects/payment-portal/functions/payment-link.js:19), [whole-record response](/Users/onp/Projects/payment-portal/functions/payment-link.js:44), [charge query](/Users/onp/Projects/payment-portal/functions/charge.js:59), and Worker equivalents.

**Finding:** IDs are not validated/encoded before interpolation into a PostgREST query; additional query syntax can enter the upstream URL. A broad query bypass was not demonstrated. Responses are not allowlisted and have no explicit `Cache-Control: no-store`; future internal columns could become public automatically.

**Fix:** Validate the supported ID format, construct queries with URL/search-parameter APIs, select/return only the explicit public contract, and mark sensitive/status responses noncacheable. Treat the payment URL as a bearer capability and preserve its entropy. Verify database constraints and RLS separately.

### 30. Security headers are incomplete in source and on inspected public responses

**Observed:** The deployed root returned `nosniff` and `strict-origin-when-cross-origin`, but no CSP, HSTS, X-Frame-Options, or noindex header. The missing-ID API response lacked these headers and cache controls. This was a public read-only check, not a scan of real payment links.

**Fix:** Define CSP compatible with the hosted field, frame-ancestor protection, a consistent referrer policy for bearer URLs, `nosniff`, appropriate HTTPS policy, and noindex for private/staff/payment pages. Apply headers to API responses too. Cloudflare's [Pages header documentation](https://developers.cloudflare.com/pages/configuration/headers/) explains that `_headers` rules do not apply to Pages Function responses.

**Acceptance:** Verify production HTML, API success/errors, and hosted tokenizer/PDF operation after introducing the policy; start with report-only CSP if necessary to identify required sources.

### 31. Unknown and incomplete payment URLs produce a blank page

**Evidence:** [Only two routes](/Users/onp/Projects/payment-portal/src/App.jsx:8).

**Reproduced:** An unknown path rendered no main content. `/pay` without an ID also has no matching customer route.

**Fix:** Add a useful not-found/malformed-link page with merchant support and clear navigation. Consider separating staff entry from the customer-facing root so recipients with a truncated link do not land on a staff passcode screen.

### 32. Dependency audit reports advisories beyond the CDN PDF library

**Measured:** `npm audit --json` reported 8 affected package entries: 6 high and 2 moderate. `npm audit --omit=dev --json` reported 2 entries: React Router and React Router DOM (1 high, 1 moderate). Counts are package entries, not distinct independently exploitable vulnerabilities. Several Router advisories concern SSR/RSC features absent from this client-only application.

**Fix:** Update compatible patched versions and lockfile, inspect applicability, then run focused route/build/parser checks. Do not call these results proof of a production exploit. Review the separate CDN PDF version in issue 17 as well.

### 33. The required lint gate fails on generated Wrangler files

**Evidence:** [ESLint ignores](/Users/onp/Projects/payment-portal/eslint.config.js:8) omit only `dist` and `worker/.wrangler`, while the current development script generates root `.wrangler/` files.

**Measured:** `npm run lint` failed with 10 errors in generated root `.wrangler/tmp` code. `npx eslint src functions worker/src` passed. `npm run build` passed.

**Fix:** Ignore generated Wrangler output consistently while retaining lint coverage of all source backends. Add focused runnable regressions for concurrent charges, unknown outcomes, parsing, and batch totals; lint/build alone cannot catch those defects. Record unfinished provider/deployment checks honestly in the Spec Kit quickstart.

### 34. Development, deployment, secret-file rules, and documentation have drifted

**Evidence:** [Dev command](/Users/onp/Projects/payment-portal/package.json:7), [contradictory README](/Users/onp/Projects/payment-portal/README.md:13), [ignore patterns](/Users/onp/Projects/payment-portal/.gitignore), [Worker-only config](/Users/onp/Projects/payment-portal/worker/wrangler.toml), and [unfinished validation task](/Users/onp/Projects/payment-portal/specs/001-payment-ui-hardening/tasks.md).

**Finding:** README calls `npm run dev` UI-only, but it builds and serves Pages Functions; `dev:ui` is the actual Vite-only command. The dev script downloads an unpinned Wrangler and serves a one-time build without a frontend watch step. There is no versioned Pages binding configuration in the inspected tree. `.env.production` and `.env.preview` are not ignored. Both backends allow mock payments via a flag without a production-specific guard. The UI spec still describes multiple old breakpoint/timeout values and has T040 unchecked.

**Fix:** Correct setup and command descriptions, pin the runtime tooling, document/build a reliable watch workflow, record environment/binding requirements, ignore appropriate secret-file variants while allowing safe example files, and prevent mock approval in production. Update contracts/quickstart to match actual behavior and completed validation.

## Deployment and data checks that still need evidence

These are required investigations, not claims that the live installation is insecure.

1. **Supabase:** Inspect table schema, amount/status constraints, UUID generation, uniqueness, RLS, anon/authenticated permissions, grants, and backups. No migrations or policies were available in this repository. The unused browser Supabase client does not prove public access is enabled.
2. **Production identity:** Verify `STAFF_PASSCODE`/identity configuration, Cloudflare Access/WAF/rate limits, and independent enforcement on both Pages and Worker deployments.
3. **Environment isolation:** Confirm preview/local deployments cannot charge the production merchant, email real recipients, or modify the production database. Confirm production mock mode is off without printing any secret values.
4. **Backend ownership:** Determine whether the standalone Worker is deployed/used. The frontend uses same-origin Pages Functions; both backends nevertheless carry duplicated payment and parser logic with differences.
5. **Merchant controls:** Verify AVS/CVV rules, fraud/velocity limits, supported brands/currencies, retry policies, partial-approval behavior, settlement reconciliation, and any applicable authentication requirements with the gateway/account configuration. Passing ZIP/CVV alone does not prove those controls are enforced.
6. **Payment-data handling:** Review application/APM/edge request logging and retention; CVV currently crosses the merchant backend. Consider provider-hosted collection of more fields or full hosted checkout if reduced data handling is a business goal; do not assume card-number tokenization certifies the complete deployment.
7. **Email operations:** Verify sending-domain authentication, delivery/bounce handling, receipt behavior, attachment limits, and alert retry coverage. No delivery webhooks or persistent notification states were found in the reviewed code.
8. **Customer-data hygiene:** The repository tracks an invoice PDF. Determine whether it contains real/private data before retaining it as a fixture; use synthetic examples. Secret scanning of history and rotation are necessary only if an actual exposure is found.
9. **Operations:** Verify safe error monitoring, correlation IDs, reconciliation alerts, refund/void procedures, outage response, backup restoration, and credential rotation ownership. Background mail requests need safe failure monitoring, not raw provider dumps.
10. **Real accessibility/provider checks:** Complete screen-reader, keyboard, mobile Safari/Chrome, zoom, blocked-iframe, live test-tokenization, decline, already-paid, and slow-response scenarios in a nonproduction environment. The synthetic iframe checks do not establish these pass.

## Useful feature improvements, in priority order

| Priority | Improvement | Customer/staff benefit | Smallest useful first version |
| --- | --- | --- | --- |
| First | Link history and recovery | Staff can find an already-created link after a lost response rather than create another | Search by invoice/customer, amount/status, copy existing link |
| First | Revoke and resend existing links | Correct a mistaken recipient or recover failed email without duplicate billing | Authenticated revoke/resend actions with a review summary |
| First | Customer receipts | Proof of payment reduces support requests | Correct amount, invoice, paid date, reference; email plus print-friendly receipt |
| First | Per-invoice review | Customers understand combined charges; staff spot duplicates and amount mistakes | Review each invoice/recipient/amount and explicit summed total |
| Next | Invoice view/download | Customers can verify what they are paying | Secure access to the reviewed original invoice with retention/access rules |
| Next | Payment status/reconciliation view | Staff can resolve unknown outcomes instead of asking customers to retry | Safe attempt status and gateway reference; no card secrets |
| Next | Refund/void workflow | Support has a clear path for corrections | Document existing gateway operations first; add an audited UI only if volume justifies it |
| Next | Better support context | Customers can get help without manually reconstructing the failure | Support link prefilled with a safe invoice/reference identifier, never payment details |
| Conditional | International billing addresses | Eligible customers can use non-US cards | Decide supported countries first; current ZIP validation allows exactly five digits |
| Conditional | Wallets or other payment methods | Faster checkout and fewer manual card entries | Confirm merchant/provider capability and demand before expanding the integration |
| Conditional | Drafts and reminders | Staff recover interrupted work and chase outstanding invoices | Keep drafts nonsensitive; define recipient/reminder frequency and paid-link suppression |
| Conditional | Accounting/order-system sync | Less repeated billing entry and manual reconciliation | Use stable invoice/account IDs and explicit status contracts before automation |

## Complexity cleanup

1. **reuse:** Consolidate duplicated Pages/Worker business logic, or retire the Worker only after confirming it has no deployed consumers. One tested implementation; deployment-specific adapters only where needed. Potentially remove most of the 947-line duplicate Worker, but the safe count depends on actual usage.
2. **delete:** Remove unused `src/App.css` (184 lines), unused browser Supabase client (10 lines), and unreferenced starter assets after verifying external/static consumers. If the browser client has no planned consumer, remove its direct Supabase dependency too.
3. **reuse:** The same 9-line safe-JSON reader exists in all three frontend files. A single small helper is enough; no API client framework is needed.
4. **delete:** Review the two direct `@emnapi/*` development dependencies; no application imports were found. Remove direct declarations only after verifying the build tool's transitive requirements. Remove unused styling such as `.form-divider` after the same reference check.

Conservative cleanup opportunity: about **210 source lines and 1 direct dependency**, from the unused CSS/client and the three JSON readers consolidated into one. More is possible if the duplicate Worker and unused direct tooling declarations can be retired. Starter assets and generated files are not included in that count.

## Validation record

| Check | Result |
| --- | --- |
| `npm run build` | PASS; 28 transformed modules; frontend JS about 267 KB / 84 KB gzip |
| `npm run lint` | FAIL; 10 errors in root `.wrangler/tmp` generated code |
| `npx eslint src functions worker/src` | PASS |
| `npm audit --json` | 8 affected package entries; 6 high, 2 moderate |
| `npm audit --omit=dev --json` | 2 affected entries; Router/Router DOM; applicability requires review |
| Synthetic backend checks | Confirmed concurrency, post-charge DB failure/retry, amount bypass, expiry omission, fail-open auth, invalid create fields, email markup injection, parser normalization errors, whole-row lookup, malformed JSON throw, partial approval marked paid |
| Synthetic browser checks | Confirmed HTTP-500 login, manual-edit overwrite, duplicate total, stale removed fields, submission during scanning, unclear email failure, missing route, stale paid state, cancelled checkout, null amount, malformed-name crash |
| Responsive checks | No normal-amount horizontal page overflow at four sizes; mobile/tablet workflows remain tall; desktop target views fit |
| Contrast calculations | Accent small text fails 4.5:1 normal-text minimum |
| Public header checks | Root and missing-ID API inspected; gaps described in issue 30 |
| Live financial/AI/database/email integration | Not exercised |

Audit harnesses and synthetic screenshots are in `/tmp/payment-portal-audit/` for this session. Backend reproduction: `node /tmp/payment-portal-audit/check.mjs`; browser reproduction: `node /tmp/payment-portal-audit/ui.mjs`. The latter uses a temporary Playwright install and the local Chrome executable; neither was added to project dependencies. These scripts reproduce current defects rather than constituting permanent passing regression tests.

## Recommended implementation order

1. Create a Spec Kit feature for backend payment integrity and authorization. Address issues 1–8 first, including the database/attempt contract and safe recovery semantics.
2. Harden invoice trust boundaries and batch review: issues 9–18. Verify money, customer/attachment consistency, and failure recovery together.
3. Complete customer/staff recovery and accessibility: issues 19–31, followed by dependency and development fixes 32–34.
4. Add the first-priority management/receipt features. Keep conditional features out until there is a clear customer or staff need.

Preserve existing useful protections: hosted card-number entry, sanitized client failure messages, visible labels/focus, field-level errors, duplicate activation guards within one form, keyboard upload/copy recovery, reduced-motion support, and the dependency-light frontend architecture.
