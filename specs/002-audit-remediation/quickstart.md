# Local Validation and Review

1. `npm install`; `npm test`; `npm run lint`; `npm run build`.
2. Run isolated PostgreSQL migration/concurrency checks with the documented test script; never point it at a remote/existing database.
3. `npm run demo` starts synthetic localhost preview with staff, pending, paid, expired and processing scenarios. It cannot contact payment/email/database services. Review customer and staff flows at 375/768/1024/1440 widths, keyboard and reduced motion.
4. Verify duplicate submits, unknown capture outcome, partial approval, missing credentials, declined card, expired link, duplicate/mixed invoices, preserved edits, removal reset, failed email and route switching.
5. Inspect diff, audit status and migration/configuration prerequisites. No push, deploy or remote migration occurs in this workflow.

Release-only prerequisites: approved migration/schema inspection, individual staff identity configuration, real nonproduction hosted field/gateway tests, merchant fraud/settlement rules, delivery/bounce handling and existing database permissions.

## Completed local validation — 2026-10-12
Node checks (16), isolated PostgreSQL migration/race/grants, lint, build, zero-advisory dependency audit and Pages compilation passed. Chrome verified workflow/real bundled PDF extraction and mobile bounds; WebKit verified 320/375/393/430 bounds plus 200% text. Review screenshots and audit mapping are linked in `reports/payment-portal-remediation-2026-10-12.md`. The local synthetic preview is running on 127.0.0.1:5176. No visible browser connector was available to auto-open it; open the local URL directly. Real UAT, production identity/database settings, mail delivery and physical mobile-device behavior remain release checks.
