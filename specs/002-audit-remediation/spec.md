# Feature Specification: Payment Portal Audit Remediation

**Created**: 2026-10-12
**Status**: Implemented locally — awaiting owner review; deployment prerequisites remain
**Input**: Fix the 7 October audit and show the result before pushing or deploying.

## User Scenarios & Testing

### User Story 1 — Safe payment and recovery (Priority: P1)
Customers pay the exact invoice once and get an accurate receipt or a safe pending outcome.
**Independent Test**: Concurrent synthetic requests, timeout after capture, failed status write, partial approval, expired and cancelled links.
**Acceptance Scenarios**:
1. Given concurrent requests, when payment starts, then only one durable attempt may charge.
2. Given an unknown financial outcome, when a customer returns or checks status, then no new charge is enabled until the existing attempt is resolved.
3. Given invalid amounts, nonpayable status or partial approval, when processing occurs, then the invoice cannot be marked fully paid incorrectly.
4. Given payment success, when the receipt appears, then focus and status announcements identify completion and receipt delivery copy is truthful.

### User Story 2 — Protected, accurate staff workflow (Priority: P1)
Staff authenticate through an expiring session and review a consistent recipient, invoice batch and total before generation.
**Independent Test**: Missing auth configuration, HTTP failures, duplicate/mixed uploads, manual corrections, partial parsing and lost creation responses.
**Acceptance Scenarios**:
1. Given missing/invalid credentials or session configuration, when staff request access, then authorization fails closed without retaining reusable credentials in browser storage.
2. Given a duplicate or mixed-customer invoice batch, when staff generate a link, then generation is blocked with actionable guidance.
3. Given background parsing, when a staff correction exists or submission starts, then it cannot be silently overwritten and incomplete scans cannot enter the submitted batch.
4. Given link insertion succeeds but email fails, when the response is shown or retried, then the same link is recoverable and email failure is explicit.
5. Given an uncertain extraction, when staff review it, then missing/contradictory values require review rather than being labeled verified.

### User Story 3 — Recoverable, accessible customer and staff UI (Priority: P2)
Customers and staff can recover from malformed routes/data, blocked card fields, slow requests and clipboard/email failures on mobile and desktop.
**Independent Test**: Four viewport sizes, keyboard operation, reduced motion, malformed data, route switching, blocked iframe and failed email.
**Acceptance Scenarios**:
1. Given a different invoice route, when navigation finishes, then only that invoice's status is displayed.
2. Given an unavailable route or malformed response, when rendering occurs, then a useful safe fallback replaces a blank page.
3. Given narrow screens and long totals, when checkout is displayed, then important data and controls stay readable with sufficient contrast and accessible focus.

### User Story 4 — Reviewable local delivery (Priority: P2)
The owner can inspect the implementation and a synthetic local preview before any external change.
**Independent Test**: Run focused regressions, lint, build and local browser checks with no financial/email requests.
**Acceptance Scenarios**:
1. Given a pending database/security configuration change, when local work finishes, then it is packaged with validation and rollback notes but never applied to production.
2. Given the audit, when the handoff occurs, then each finding is marked fixed locally, partially addressed, or dependent on external verification.

## Edge Cases
Concurrent tabs; lost responses; gateway approval with failed database update; gateway malformed/partial/retry response; failed claim response; malformed IDs/body; missing auth/secrets; session expiry; duplicate creation requests; failed email/body timeout; expired/revoked links; invalid AI structures/signs/currency; zero/negative balance; scanned PDFs; large/tall images; mixed/duplicate invoices; removing every invoice; unmount during scans; late tokenizer response; keyboard and screen-reader completion; long values and zoom.

## Functional Requirements
- FR-001: Claim a durable financial attempt before any charge; preserve unknown outcomes and prevent unsafe retries.
- FR-002: Charge only canonical positive exact amounts, validate gateway results, enforce payable status/expiry and reject raw payment input where a hosted token is required.
- FR-003: Staff authorization fails closed, sessions expire, reusable credentials are not persisted in the browser, and login attempts are bounded across backend instances.
- Staff sign-in configuration errors MUST identify invalid setting names without revealing their values; database rate-limit failures MUST be distinguished from incorrect passcodes.
- FR-004: All touched APIs use explicit contracts, bounded requests, allowlisted output, sanitized errors and appropriate response headers.
- FR-005: Validate invoice extraction at the trust boundary and require missing/conflicting billing values to be corrected in the form.
- FR-006: Prevent duplicate/mixed batches, preserve manual corrections and bound file resources. Staff can submit valid billing details directly without confirmation checkboxes. An incomplete invoice must not produce a partial automatic invoice-number list or total; staff enter those values explicitly. Unreadable attachments remain blocked until removed.
- Staff UI uses one unnumbered form with concise labels and a large, full-width upload area. Invoice files can be dropped anywhere in the authenticated staff page, including margins and form fields; text dragging remains unaffected and file drops cannot navigate the browser away.
- Center the staff page. Checkout has concise invoice/payment headings without numbered steps or repeated instructions; labels, accessible errors and loading/recovery messages remain.
- FR-007: Link creation is recoverable across retries; email failure cannot conceal an already-created link or trigger a new billing record.
- FR-008: Complete truthful receipts, route/data recovery, focus/status semantics, contrast and shorter mobile flows.
- FR-009: Consolidate duplicated backends without removing deployed entrypoints; fix lint/dependency/configuration drift.
- FR-010: Provide a local synthetic preview, regressions and per-audit-item status; do not push, deploy or migrate production.

## Cardholder and Mobile Amendment — 2026-10-12
- The customer MUST enter a separate required Name on card, independent of the invoice customer, with accessible validation and autofill.
- The entered name MUST be validated on the server and sent to the processor, without being persisted/logged by the portal or presented as proof of identity.
- The security-code input MUST fit fully within the mobile form at 320/375/390/430px and under zoom. A single column is acceptable on narrow screens.
- Validation MUST test a cardholder name different from the invoice customer and reject missing/oversized names.

## Key Entities
Payment link; financial attempt; staff session; login-rate bucket; reviewed invoice batch; link creation request; notification delivery result. Financial attempts contain no payment credentials or card input.

## Security & Privacy Requirements
- SEC-001: Never log, persist, commit or return card numbers, CVV, payment tokens or infrastructure/customer secrets.
- SEC-002: Validate IDs, exact money, fields, attachments and model output before trusting them; escape all email text/attributes.
- SEC-003: Preserve bearer-link entropy and minimize public/customer data; use no-store, referrer and framing controls.
- SEC-004: Local preview is synthetic and cannot contact production payment, database or email services.
- SEC-005: Never release an unknown financial attempt based solely on elapsed time. Recovery must establish the gateway outcome.

## Success Criteria
- SC-001: Concurrent and replayed payment tests produce one financial request per active attempt.
- SC-002: Unknown and post-capture failures never offer an unsafe new charge.
- SC-003: Invalid amounts/model types, duplicates and mixed recipients cannot silently become accepted billing data.
- SC-004: Staff authentication failures never open the workspace; sessions contain no persisted reusable passcode.
- Staff passcode configuration accepts values of at least 10 characters; rate limits and expiring sessions remain required.
- SC-005: Normal mobile/desktop layouts do not overflow horizontally; completion and errors are keyboard-accessible.
- SC-006: Focused checks, lint and build pass; unverified deployment/provider checks are explicitly named.

## Assumptions and Scope
Fix existing audit defects, preserving current branding and merchant/provider. Optional wallets, international checkout, reminders, accounting sync and a full administration dashboard are separate work. Short-lived server-verified staff sessions strengthen the existing passcode workflow; individual SSO requires the owner's identity-provider/Cloudflare Access configuration and remains a named deployment requirement. Database migrations are prepared and tested in isolation, not applied remotely. Gateway, email delivery, RLS and external configuration are verified only with synthetic/local resources in this task.
