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
processing, expired and staff/email-failure states. If staff sign-in is shown,
the demo passcode is `preview`.

The real payment flow requires a separate **Name on card**, which can differ
from the invoice customer. It is validated and sent to CardPointe as `name`;
the portal does not claim issuer name-match verification. Expiration and security
code stack on screens at most 430px wide; all inputs have bounded widths.

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
- Staff must review the final billing details. Scanning, duplicate invoice numbers,
  duplicate file content and mixed recipients block accidental consolidation;
  explicit edits are preserved and removing all files resets billing details.
- Uploads are limited to 5 files, 5 MB each and 10 MB total. Readable attachments
  can be reviewed manually when extraction fails or a PDF is scanned.
- Stable request IDs recover link creation after lost responses. Email acceptance
  and failure are separate from link creation; user copy does not promise delivery.
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
