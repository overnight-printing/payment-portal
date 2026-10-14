# Feature Specification: Staff Payment Dashboard

**Feature Branch**: `main` (local review; no push)
**Created**: 2026-10-12
**Status**: Implemented locally; awaiting owner review
**Input**: Staff cannot track which invoice links were emailed, paid or unpaid.

## User Scenarios & Testing

### User Story 1 — Track payments (Priority: P1)
Staff open a dashboard to see all existing payment links and paid/unpaid totals.
**Independent Test**: A sample collection with paid, unpaid, expired and processing links displays accurate counts and amounts.
**Acceptance Scenarios**:
1. Given a signed-in staff member, opening Dashboard shows newest links first with invoice, customer, email, amount, created date, payment state and paid date.
2. Given an unpaid link with an unresolved payment attempt, its state is Processing or Needs review; the dashboard cannot initiate another charge or change payment status.
3. Given signed-out staff, opening Dashboard requires the existing staff sign-in and reveals no records.

### User Story 2 — Track invoice emails (Priority: P1)
Staff distinguish emailed links from links generated without email and failed email attempts.
**Independent Test**: Synthetic accepted, failed, not-requested and legacy-unknown records show distinct truthful labels.
**Acceptance Scenarios**:
1. Given email-provider acceptance, the link shows Sent, meaning accepted for sending rather than confirmed delivery.
2. Given a link generated without email, it shows Not emailed; a failed send shows Email failed.
3. Given an old link without trustworthy history or an interrupted send, it shows Unknown; a replay cannot downgrade a recorded Sent status.

### User Story 3 — Find and reuse links (Priority: P2)
Staff search invoices/customers/emails, filter payment and email states, page through results, refresh and open or copy a link.
**Independent Test**: Search and filters narrow a multi-page sample set while overall totals remain unchanged.
**Acceptance Scenarios**:
1. Search is literal and case-insensitive; filter changes start from the first page.
2. Copy success is announced; clipboard failure provides a selectable link.
3. A loading failure shows Retry without pretending the dashboard is empty or presenting stale results as current.

### Edge Cases
Empty history, no matches, nullable historical customer/date fields, combined invoices in one link, same invoice on multiple links, expired/cancelled links, session expiry, network failures, invalid query parameters, concurrent creation retries and email acceptance followed by a tracking-write failure. No parsing, charge, expiry or receipt behavior changes.

## Requirements
### Functional Requirements
- **FR-001**: Provide a protected staff workspace with Overview landing page, persistent navigation, embedded invoice creation, payment history and customers using the existing staff session.
- **FR-002**: Show all existing links; rows contain only staff-relevant invoice/customer, amount, dates and payment/email status.
- **FR-003**: Show overall link count, paid count/total and unpaid count/total, independent of filters and page size. Totals count links, not deduplicated invoices or accounting receivables; unpaid includes expired/cancelled links.
- **FR-004**: Distinguish Paid, Unpaid, Processing, Needs review, Expired and Cancelled. Paid takes precedence; unresolved attempts take precedence over expiry, avoiding a false safe-to-retry impression.
- **FR-005**: Record future email outcomes and preserve unknown historical outcomes. Sent indicates provider acceptance only.
- **FR-006**: Provide literal search (maximum 100 characters), payment/email filters, bounded pagination, refresh, open and copy actions.
- **FR-007**: Provide mobile layouts, keyboard operation, labelled controls, visible focus and announced loading/errors/results.
- **FR-008**: Document each touched API contract and return only sanitized errors. Preserve existing link creation and payment callers.
- **FR-009**: Prepare an additive migration and verify old records/privileges. Keep implementation local for review; apply migration before deploying code that uses it.

### Key Entities
Payment link: invoice identifiers, customer contact, exact USD amount, created/paid timestamps, payment state and email-send history. Dashboard snapshot: overall counts/totals, filtered result count and one page of links. Payment attempt: existing durable state, read only.

### Security & Privacy Requirements
- **SEC-001**: No raw card data, CVV, payment tokens, service/API keys or customer secrets may be logged, stored, committed or returned.
- **SEC-002**: Existing authentication protects every listing request; customer history is never exposed to public routes or browser storage. Database listing privileges remain service-only.
- **SEC-003**: Validate filters and paging on trusted boundaries; enforce rate limits and no-cache responses. Use existing providers only.

## Success Criteria
- **SC-001**: Staff can identify a link's payment/email state without opening checkout.
- **SC-002**: Sample totals reconcile exactly to all stored link amounts and remain unchanged when paging or filtering.
- **SC-003**: Staff can find an invoice and open/copy its link within three actions after reaching Dashboard.
- **SC-004**: Layout and controls fit 320px mobile through 1440px desktop; signed-out requests return no history.

## Assumptions
Reuse current staff access and portal styling. Historical email delivery cannot be reconstructed. Dashboard tracks links rather than reconciling externally paid invoices or refunds. No reminders, bulk emailing, manual paid-state edits or provider delivery webhooks are included. Rollback uses previous app code and leaves additive data in place.

## Integrated workspace amendment — 2026-10-12

User approved a Stripe/Square-style staff workspace using supplied references; all staff features must live inside the dashboard. Overview becomes the signed-in landing page. Persistent navigation leads to Overview, Invoices & payments, Send payment link and Customers. Public checkout remains the existing customer flow.

### User Story 4 — Navigate the whole workflow (P1)
A staff member signs in once and moves between overview, invoice list, invoice creation and customer history inside one branded shell.
Acceptance: all pages retain sidebar/header; mobile navigation is keyboard-operable; creation fields survive internal navigation; navigation is locked during creation/recovery; successful creation offers an internal invoice-details action and appears in history without a new duplicate record. Overview has unpaid/paid amounts, links emailed, attention count and recent/unpaid quick views.

### User Story 5 — Invoice details and send/resend (P1)
Selecting an invoice opens an accessible side panel inside the workspace with invoice/customer/contact/amount, link and expiry, paid date, latest email state and recorded send history. Staff can copy/open the existing link, explicitly send/resend an eligible unpaid link or view a paid receipt. Resending never creates a new link, changes money or expiry, or inflates totals. Paid, expired, cancelled and processing/review links cannot send payment reminders. Original attachment files are not retained; resend sends the payment link only. Pending/unknown sends cannot silently launch another email; history distinguishes latest outcome from previous acceptance. First creation email uses the same durable claim path.

### User Story 6 — Customers and date filters (P2)
Customers are grouped by normalized nonempty email, with link counts, paid/unpaid totals and last activity. Missing emails stay separate. Selecting a customer shows exact scoped invoice history. Invoice list date filters use inclusive Seattle calendar days, reject inverted/invalid ranges, and preserve overall summary totals. Historical duplicates are not automatically merged into accounting balances.

Failure/rollback: auth closes every new endpoint; bounded query and read responses; same-origin writes; durable email claim precedes provider call; unknown sends remain Unconfirmed until merchant review. Source stays local for review. No refunds, manual payment-state changes, bank payouts, fake trend metrics or empty navigation sections are added. All data/API contracts and tasks are amended before source changes.

## Full-window and compact-table amendment
Staff workspace fills browser width and at least browser height with no outer margins, width cap or rounded frame. Desktop sidebar stays visible at the viewport top. Invoice and customer rows use compact spacing while retaining readable contact/status/date data, keyboard focus and 44px actions. Mobile remains a readable stacked layout. Long customer names/invoice identifiers may wrap instead of clipping. This is UI-only; all financial, email and API contracts remain unchanged.

## Staff payment-confirmation clarity amendment — 2026-10-13
Staff payment confirmations must be easy to read and copy into operations/accounting workflows. Restore a [Paid] inbox subject with invoice identifier and exact USD amount. Dedicated internal alert shows a labelled, high-contrast two-column summary: invoice(s), amount paid, payment method/masked last four when known, customer/company as recorded, customer email and payment reference. Remove the Paid At (Seattle) field. Plain-text alternative uses the same fields and labels. Do not invent missing card details or dates or split stored names/companies by guessing. Payment-request emails, recipients, provider idempotency and capture behavior stay intact. This is presentation-only, local for review; no real email/payment during verification.

Customer and staff confirmations must have distinct professional layouts using the existing logo on white, navy/blue brand colors and Arial. Customer receipt emphasizes successful payment and amount, then invoice, customer, payment method, reference and a concise payment date when recorded. Staff email emphasizes a compact, copyable operational summary without a greeting or payment-time row. Both have escaped HTML and plain-text alternatives; no invented fees, taxes, balances or installment information. Preview both exact templates with synthetic data at desktop/mobile widths before any release. If images are blocked, brand alt text and all receipt details remain readable.

Receipt refinement: remove literal USD indications from both confirmation HTML/text, remove the STAFF CONFIRMATION heading, and match the staff email to the customer logo/navy payment header with centered amount and a circular success mark. Preserve the distinct operational/customer detail bodies and plain-text alternatives. Payment currency and request/API contracts stay USD; this is display-only.
Staff inbox subjects also include the recorded combined customer/company name (Customer fallback when absent), invoice identifier and comma-grouped amount. Both confirmation HTML/text amounts use US thousands separators with two decimals (including 1,000.00). Do not guess separate company names. Subject names reject control characters and collapse extra whitespace; payment processing uses existing exact decimal values.
Success icon should match the supplied reference: pale blue filled circle surrounding a blue outlined circle/check, with crisp drawn strokes rather than a font glyph.

## Operations and receipt recovery amendment — 2026-10-13
Approved scope: email delivery/bounce tracking, paid customer receipt resend/recovery, actionable Needs attention, cancellation of incorrect unpaid links, safe expired-link replacement, and filtered CSV export. Preserve the approved full-window/compact workspace and branded email designs; no production writes, real sends, charges or deployment during implementation.

### US7 Track delivery (P1)
Staff sees provider acceptance separately from Delivered (recipient mail server), Bounced, Failed, Delayed, Suppressed and Spam complaint. Payment-link emails and customer receipts have separate latest statuses and durable history. Signed events arriving before send finalization, replayed/out-of-order events and multi-recipient staff alerts must remain correct. Historical unconfirmed delivery stays Unknown/Accepted, never invented Delivered. Unknown send with missing provider identity remains locked; Check email status can query a known message without re-sending it.

### US8 Recover receipts (P1)
Paid invoice details offers Send/Resend receipt to the recorded customer. Capture and reconciliation use durable initial customer/staff receipt claims; repeating the initial or explicit request does not send twice even beyond provider idempotency retention. A deliberate later resend uses a new request identity; uncertain in-flight receipt blocks another. Receipt actions never alter payment/link/amount or re-send staff alerts. Unpaid/uncertain invoices cannot get paid receipts. Receipt failure cannot undo confirmed payment or make it look unpaid.

### US9 Resolve attention (P1)
Show concise server-derived reasons and matching actions: check payment, check email status, resend a definitively failed message/receipt, replace expired link, or contact merchant/customer for manual review. Staff payment check performs inquiry only, including expired invoices and review attempts; only an exactly matching full capture can finalize paid. Recent processing stays processing; unknown/not-found/partial/mismatched responses stay locked. No manual mark-paid/unlock button.

### US10 Manage and export invoices (P2)
Cancel an unpaid link only after explicit UI confirmation and atomic no-active-payment guard. Preserve history; paid/processing/review links cannot be cancelled. Replace an expired unpaid link with one successor using the recorded amount/customer/invoices and fresh 30-day expiry; original remains cancelled with relationships visible. Concurrent/replayed replacements yield the same successor, never multiple payable links; no automatic email. Cancelled/superseded records stay in history but leave outstanding counts/amounts. Export all rows matching invoice filters across pages to CSV from one bounded snapshot; reject more than 10,000 rows explicitly rather than truncate. Escape quotes and protect spreadsheet formula-leading fields; no card/provider secrets or capability URLs.

Security/failure: staff actions require session, same-origin and durable rate limits. Webhook is public only with bounded raw-body HMAC verification, timestamp tolerance and durable event dedupe; persist allowlisted metadata only. Provider IDs/tags/recorded recipients must match before applying status; provider events never mark a payment paid. SQL service-only grants/RLS and existing row-lock ordering remain. Failed database finalization leaves sends uncertain/locked; unavailable external service has sanitized retry guidance. New additive migration must be applied after 001–003 and verified before any approved deployment. Rollback retains financial/mail history; no destructive rollback while uncertain work exists.

Acceptance: replay/early/out-of-order/bad-signature/bad-recipient webhooks preserve state; paid receipt failure appears in attention; repeated receipt/cancel/replace calls are safe; payment checks make zero auth/capture calls; replacement preserves outstanding amount once and paid totals; exported filtered rows exceed one UI page without duplicates; long/mobile controls remain accessible. Real webhook registration/signing secret and production email delivery remain release prerequisites.

### US11 Browse a manageable recent list (P1)
Invoice and customer lists default to the last 30 Seattle calendar days, inclusive of today. Staff can select All time or a custom created-date range to reach older history. Explicit existing date URLs remain honored. Date, search, payment/email/customer filters, chosen page size and pagination compose without losing selection; changing filters or size resets to page one. Offer 10, 25 (default), or 50 rows on invoices/customers; keep visible Previous/Next and current/total pages even for one/zero results, with correct disabled boundaries and showing-range counts. Existing overview financial cards stay clearly labelled all-time and link to matching all-time history; its recent list defaults to 30 days. Customer drilldown and CSV retain selected dates. No deletion/financial changes. Acceptance: 30-day edges include today/29 days ago across Seattle midnight/DST; default list excludes older rows, All time/custom retrieve them; next/previous and 10/25/50 yield exact bounded nonduplicated pages, page reset and browser back restore filters/size; empty/one-page controls stay accessible and mobile layout fits.

US11 pagination refinement: center the Previous/page-number/Next group in the table footer. Render clickable numbered pages, highlight/announce the current page, and preserve filters/size when jumping. Show all numbers for up to seven pages; for longer lists show first/last and neighboring pages with ellipses, bounded controls that fit mobile. Keep showing-range count centered below the controls and existing disabled boundaries.

### US12 Consistent portal presentation (P1)
Clean up overview, invoice/customer lists, sending, sign-in, invoice drawer, customer checkout and payment receipt screens while retaining the approved navy/blue palette, Arial, real logo, full-screen staff layout and all existing features. Standardize 44px controls, 8px corner radius, 14px button text, 18px control icons, regular spacing and accessible hover/focus/disabled states. Keep upload target >=180px, compact desktop rows, centered numbered pages, date/page-size filters and mobile CVV visibility. Align toolbar/filter fields and financial values; simplify visual card/icon treatments and unreadably small labels. Presentation-only DOM wrappers/classes/assets may change; event handlers, routes, form fields, validation, locked/recovery states, persisted records, emails and payment/API contracts must not change. Keyboard order/focus, labels, print and reduced motion must remain usable. Acceptance: consistent control geometry across screens, 320–2560px page fit, compact 1440px rows, 200% text zoom/long strings, preserved invoice drop/creation/receipt/email/export/cancel/replace and synthetic checkout flows. No real service mutations in testing.

US12 redundancy refinement: invoice/customer lists show one result-range count beneath the centered paginator, without repeating the total above the table. Invoice payment filters use one set of buttons containing all eight existing options, without a duplicate status dropdown. Preserve overview count (no paginator), page-size selection, loading/error announcements, selected filter/URL state and responsive keyboard-accessible controls. No financial, data or API changes.

## US13 One-day staff session (P1)
Successful staff sign-in issues a signed HttpOnly/Secure/SameSite=Strict cookie valid for 24 hours (86,400 seconds) from sign-in, with matching browser Max-Age and server expiry. It is a fixed lifetime, not refreshed by activity. At the expiry second and later, staff APIs reject the session. Tampered cookies, invalid credentials and cross-origin writes remain rejected; sign-out clears the cookie and passcode/secret changes invalidate existing signatures. Existing one-hour cookies retain their signed expiry; signing in again obtains the new lifetime. No payment-link expiry or other flow changes.

## US14 Old unpaid link cleanup and drawer dismissal
Owner authorizes a one-time cancellation of currently uncancelled unpaid links created strictly more than 30 elapsed days before execution. Include expired unpaid links; exclude paid, already cancelled, missing creation dates and unresolved processing/unknown/review attempts. Use existing portal_cancel_link row-lock/payment guard for each candidate, retain all invoice/payment/email history, and verify paid records and other business fields unchanged. Do not send emails or change customer balances/charges. No recurring auto-cancellation feature. Clicking/tapping the main-screen backdrop closes invoice details, while interactions or scroll drags within the panel remain open; dismissal stays blocked while an action is pending. Preserve Escape/close button and focus return.
