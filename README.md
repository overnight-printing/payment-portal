# Payment Portal

React/Vite customer checkout and staff invoice intake with shared Cloudflare
Pages/Worker handlers and a Supabase payment-integrity boundary.

## Review the changes locally

```bash
npm install
npm test
npm run test:db
npm run lint
npm run build
npm run demo
```

Open http://127.0.0.1:5176. This localhost-only preview uses synthetic invoices,
card selection, sessions and delivery outcomes. It does not connect to CardPointe,
Supabase, Workers AI or Resend. Use the preview navigation for checkout, paid,
processing, expired, dashboard and staff/email-failure states. If staff sign-in is shown,
the demo passcode is `preview`.

The real payment flow requires a separate **Name on card**, which can differ
from the invoice customer. It is validated and sent to CardPointe as `name`;
the portal does not claim issuer name-match verification. Expiration and security
code stack on screens at most 430px wide; all inputs have bounded widths.

## Staff workspace

Staff land on Overview at `/` or `/dashboard`. The same session and persistent
navigation cover `/invoices`, `/send` and `/customers`. Staff sessions last
24 hours from sign-in; sign out and back in to obtain the longer duration for
an existing session. The staff workspace fills
the browser window edge-to-edge; invoice/customer tables use compact rows and
retain keyboard controls and 44px action targets. Controls share 44px heights,
8px corners and consistent text/icons across staff and customer screens.
Narrow desktop tables scroll within a labelled, keyboard-accessible region;
mobile cards retain every field/action. The approved navy/blue palette, Arial
and original logo are retained. Invoice upload/creation
stays inside the workspace; draft fields survive internal navigation.
After creating a link, upload the next customer’s invoices directly or click
Send another to reset the form. The previous result clears when a valid new
batch starts; pending and uncertain requests keep their recovery locks. Creation
and unresolved recovery lock navigation to prevent duplicate operations.

Overview shows paid/unpaid link amounts, latest customer email accepted/delivered count, attention
items and recent/unpaid quick views. Invoices support literal search, payment and
email filters, Seattle created-date ranges, paging, copy and a details side panel.
Close invoice details by clicking outside, using Escape, or the close button;
dismissal is blocked while an action is pending.
Invoice/customer lists default to the last 30 days with 25 rows per page.
Payment status options appear once as filter buttons; paginated lists show one
result-range count beneath the page controls.
Choose 10, 25 or 50 rows, jump using centered numbered pages/Previous/Next,
or select All time/Custom dates
to view older records. CSV and customer drilldowns preserve the selected dates.
Overview totals are all-time and open matching all-time history.
Customers group by normalized email and open exact scoped invoice histories.
History counts stored links rather than deduplicated accounting receivables.
Cancelled/replaced links remain in history but are excluded from unpaid counts
and outstanding amounts; expired active links remain unpaid. Historical records are never merged by guess.

The details panel shows payment/link/receipt statuses, expiry, recorded email
attempts and specific attention reasons. Staff can send/resend an eligible unpaid
link using Send email in its details panel. The inline Name/Email form can add
missing contacts or edit saved contacts; sending saves them on the same invoice
and reuses its link. Staff can also send/resend a customer receipt for a paid invoice, check a known email's
provider status, or perform inquiry-only payment checking for uncertain outcomes.
Receipts never trigger another charge or re-send staff alerts. Durable claims
protect both initial receipts and deliberate resends beyond provider retention.
Unconfirmed sends stay locked until verified evidence resolves them; missing
provider IDs require provider review. Later link sends cannot reconstruct original
invoice attachments. Accepted and Delivered are distinct; Delivered means the
recipient's mail server accepted the message, not that the customer read it.
Older unrecorded history stays Unknown.

Unpaid links can be cancelled with confirmation when no payment attempt is active.
Expired unpaid links can be replaced atomically with one new 30-day link; history
is retained and replacement does not automatically email anyone. Paid/processing/
review links cannot be cancelled or replaced. No manual mark-paid, uncertainty
unlock, refund or bank-payout action exists.

Export CSV downloads all matching invoice-filter results across pages from one
snapshot, up to 10,000 links. Larger matches require narrower filters. Text that
could become a spreadsheet formula is prefixed with an apostrophe; exported
amounts remain plain exact decimals. No card credentials or payment URLs appear.

Before pushing, apply and verify prepared migrations in order: dashboard 002,
workspace 003, then `202610130004_staff_operations.sql`. The first integrity
migration is already applied to production. Migrations preserve original fields
and add service-only history/actions. Main pushes auto-deploy Cloudflare Pages.
Owner authorized production release on 2026-10-13. Migrations 002–004 are now
applied and verified against unchanged original invoice fields. The workspace
and operations are deployed at https://pay.overnightprintingseattle.com/.
Resend message reads and the signed seven-event webhook are configured and
enabled. Older untracked delivery history remains Unknown. See [the validation guide](specs/003-staff-dashboard/quickstart.md).

For live delivery tracking after an approved deployment, register
`https://pay.overnightprintingseattle.com/resend-webhook` in Resend and subscribe
to `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`,
`email.failed`, `email.complained` and `email.suppressed`. Set its signing secret
as `RESEND_WEBHOOK_SECRET` in the matching Pages Production environment (and
Worker environment if used), then redeploy to activate that binding. Never put
this secret in source or frontend variables. The existing RESEND_API_KEY must
allow retrieving sent emails for Check email status. Webhooks verify bounded
raw body signatures/time and dedupe durable per-recipient events. Test provider
events on nonproduction before production release; no real messages were sent
by local verification. See [Resend webhook setup](https://resend.com/docs/webhooks/introduction)
and [signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests).

## Development with real nonproduction services

```bash
cp .env.example .env.local
cp .dev.vars.example .dev.vars
# Supply TEST service credentials in ignored .dev.vars.
npm run dev
```

`npm run dev` builds and serves the UI plus Pages Functions on port 5175 using
pinned Wrangler. For continuous frontend rebuilds, run `npm run dev:watch` in
another terminal. `npm run dev:ui` serves Vite only; same-origin APIs will not
work there. Image analysis needs the Pages/Worker `AI` binding. PDF text extraction
uses the bundled PDF.js/worker, disables eval and supports up to 20 pages.

## Payment and staff guarantees

- A service-only database RPC atomically claims an attempt before authorization.
  Separate clients cannot start concurrent financial requests for one invoice.
- Authorization uses the canonical exact USD amount; partial or malformed
  approvals are not captured as full invoice payments. Capture must be confirmed.
- Unknown gateway/capture/database outcomes remain locked. The UI offers status
  checking and merchant support, not blind payment retry. Merchant reconciliation
  must establish the outcome before releasing a claim.
- The hosted card field tokenizes on blur. Exact frame origin/source and token
  shape are checked; card edits invalidate tokens; reload replaces timed-out frames.
- Staff access fails closed, uses an expiring HttpOnly session, and rate-limits
  login through durable salted-IP buckets. No reusable passcode is retained in
  localStorage. Individual staff SSO remains a deployment identity prerequisite.
- Staff use a full-width form with invoice intake and billing details side by side
  on desktop, stacked on mobile. Invoices can be dropped anywhere on the page.
  Name and email are optional for Create link; both are required for direct
  email sending. A supplied email must be valid. Without an email, payment still
  works and staff receives confirmation, but no customer receipt is sent.
  Cardholder name remains required at checkout. Valid details can be submitted directly. Scanning, duplicate invoice numbers,
  duplicate file content and different customers/companies block accidental consolidation.
  Different contacts with the same explicit company can share one AR link.
  Missing invoice emails do not discard confirmed amounts; if contact emails
  differ, enter the shared billing email once. TOTAL-only amounts require manual
  balance confirmation. Explicit edits are preserved and removing all files resets billing details.
- Uploads are limited to 20 files, 5 MB each and 10 MB total. Readable attachments
  can be reviewed manually when extraction fails or a PDF is scanned.
- Stable request IDs recover link creation after lost responses. Email acceptance
  and failure are separate from link creation; user copy does not promise delivery.
- Customer receipts and internal paid alerts use distinct branded layouts with
  the existing logo, navy/blue colors and Arial. Customer receipts emphasize the
  paid amount and concise payment date; staff get the same navy payment header,
  a compact labelled summary and `[Paid]` subject with customer/company, invoice
  and amount. Both use a pale-blue circled check and grouped amounts ($2,596.96),
  without USD labels. Staff payment-time wording is removed.
  Both include copyable plain text; recipients and notification identities stay
  the same. Local samples are in `.preview/customer-payment-confirmation.html`
  and `.preview/staff-payment-confirmation.html`; no real emails were sent.
- Errors, API output and emails are sanitized/allowlisted. Card credentials and
  raw model/provider responses are never logged or persisted by this code.

## Required before a future release

Production repair on 2026-10-12: the payment-integrity migration was applied to
the payment-portal Supabase project. Live staff sign-in, session verification
and logout passed. All 290 original links and invoice fields were preserved
(206 paid, 84 pending). Existing source pushes trigger Cloudflare Pages builds.

1. Review `supabase/migrations/202610120001_payment_integrity.sql` against the
   actual `payment_links` schema and other consumers. It adds durable attempts,
   creation identity, 30-day expiry and notification state; enables link-table RLS
   and revokes direct anon/authenticated table access. It is applied to the
   production payment-portal project; inspect any other environment before
   applying it there. Preserve attempts and financial history during rollback.
2. Configure `APP_ENV` (`development` or `production`), `PUBLIC_ORIGIN`, service
   credentials, a staff passcode of at least 10 characters and a separate
   `SESSION_SECRET` of at least 32 random characters. Secrets belong in secret
   stores/ignored files, never frontend `VITE_` variables. Mock payment mode is
   disabled. The lookup response selects the corresponding production/UAT hosted field
   from backend `APP_ENV`, so the frontend does not independently choose a gateway.
3. Configure the Pages `AI` binding if image extraction is needed. Pages and the
   standalone Worker share handlers; keep their environment settings consistent.
4. Verify individual identity/Cloudflare Access, merchant AVS/CVV/fraud policies,
   real UAT tokenizer/auth/capture/decline tests, settlement/reversal and refund
   procedures, email delivery/bounce operations, backups and current database grants.
5. Verify CSP and HTTPS headers on both static pages and function responses,
   including real hosted fields and representative PDFs in mobile Safari.

The isolated SQL check creates and destroys its own socket-only PostgreSQL
cluster. It never contacts an existing/remote database. It uses Postgres.app 17
on this machine; elsewhere set `PG_BIN` to a PostgreSQL binaries directory.

See [the remediation specification](specs/002-audit-remediation/spec.md),
[API contracts](specs/002-audit-remediation/contracts/api.md), and
[validation guide](specs/002-audit-remediation/quickstart.md).

Payment links now use `/p/<22-character code>` on the portal domain. The code
encodes the full existing UUID; old `/pay/<UUID>` URLs remain valid. Creation,
recovery, dashboard sharing and request emails use the same format. No external
shortener or additional database mapping is involved. Keep both routes when
rolling back so issued short links continue to open.

After creating a link, the cleared billing form becomes a concise result with
the amount, invoice, link and copy action. Send another or a new upload starts
the next invoice. Failed/unconfirmed email warnings and manual-copy fallback remain.

Customer checkout uses a branded header, prominent amount/invoice and plain
billed-to details beside one card form (stacked on mobile). Hosted card fields
reset their own browser margins/padding and match the native 50px controls.
The hosted input owns its keyboard-focus outline across the iframe boundary.
No processor, payment API, link, receipt or staff behavior changed.
