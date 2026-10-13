# Tasks: Staff Dashboard

Input: spec.md, plan.md, research.md, data-model.md, contracts/staff-dashboard.md.

## Phase 1: Setup
- [x] T001 Define scope, security gates, contracts and release order in `specs/003-staff-dashboard/` and update `AGENTS.md`.

## Phase 2: Foundation
- [x] T002 Add bounded dashboard query/response checks in `shared/validation.js` and assertion coverage in `tests/portal.test.js`.

## Phase 3: US1 Track payments (P1)
Goal: protected list and accurate overall totals. Independent test: synthetic paid/unpaid/expired/processing records reconcile without public access.
- [x] T003 [US1] Add SQL snapshot/read permissions and additive email column in `supabase/migrations/202610120002_staff_dashboard.sql`; verify isolated legacy compatibility and summary/filter/grants in `scripts/test-database.mjs`.
- [x] T004 [US1] Add protected shared listing in `server/api.js` and `functions/staff-links.js`, with authentication/filter/error tests in `tests/portal.test.js`.
- [x] T005 [US1] Add route and reusable staff gate in `src/App.jsx` and `src/pages/CreateLink.jsx`; add dashboard summaries/list in `src/pages/Dashboard.jsx` and responsive styling in `src/index.css`.

## Phase 4: US2 Track invoice emails (P1)
Goal: accurate future email history, truthful legacy unknown. Independent test: accepted/failed/not_requested/recovered outcomes and concurrent retries.
- [x] T006 [US2] Persist monotonic email outcomes and extend recovery in `server/api.js`, `src/pages/CreateLink.jsx`, and `tests/portal.test.js`.

## Phase 5: US3 Find and reuse links (P2)
Goal: search/filter/paging/refresh/open/copy. Independent test: filtered pages, unchanged overall totals, safe clipboard fallback and failure recovery.
- [x] T007 [US3] Finish labelled query controls and link actions in `src/pages/Dashboard.jsx`; add synthetic multi-state history to `scripts/preview.mjs`.

## Phase 6: Validation and review
- [x] T008 Run API/isolated SQL checks, lint/build and Pages compilation; run focused browser assertions for dashboard plus existing staff/checkout; record evidence in `specs/003-staff-dashboard/quickstart.md`.
- [x] T009 Update `README.md` and `reports/payment-portal-remediation-2026-10-12.md` with dashboard behavior, limits and migration-before-deploy order; present local preview without push/deploy.

## Dependencies and Execution
T001 → T002 → T003/T004 → T005 → T006 → T007 → T008/T009. Tests precede nontrivial logic and source edits remain sequential. SQL and API fixture checks are independent validation opportunities; documentation and CSS changes can be reviewed separately. MVP is US1, then email tracking and find/reuse finish the requested scope. Every task has concrete file paths; no implementation agents required.

## Phase 7: Integrated staff workspace amendment
- [x] T010 Amend approved workspace stories, model, contracts and plan in `specs/003-staff-dashboard/` before code.
- [x] T011 [US4] Add persistent shell/routes and embedded creation form in `src/components/StaffShell.jsx`, `src/App.jsx`, `src/pages/CreateLink.jsx`, `src/components/Icon.jsx`, `src/index.css`.
- [x] T012 [US5] Add durable email claim/finish and invoice detail in `supabase/migrations/202610120003_staff_workspace.sql`, `server/api.js`, `functions/staff-link.js`, `functions/send-link-email.js`; update `tests/portal.test.js`, `scripts/test-database.mjs`.
- [x] T013 [US6] Add date/customer query, summary metrics and customer aggregation in `shared/validation.js`, workspace migration, `server/api.js`; verify grouping/date/privacy contracts in API/SQL checks.
- [x] T014 [US4] [US5] [US6] Build Overview, invoice table, details/email actions and customer history in `src/pages/Dashboard.jsx`; update `scripts/preview.mjs` synthetic contracts.
- [x] T015 Verify API/SQL, lint/build/Pages and Chrome/WebKit shell/creation/dialog/mobile/mail scenarios; record in `specs/003-staff-dashboard/quickstart.md`, `README.md`, `reports/payment-portal-remediation-2026-10-12.md`; show local preview without deployment.

Amendment order T010 → contract tests/T012+T013 → T011+T014 → T015. No implementation delegation.

## Phase 8: Full-window and compact tables
- [x] T016 Make staff shell edge-to-edge and compact invoice/customer rows in `src/index.css` and `src/pages/Dashboard.jsx`; verify desktop/mobile bounds, row density and interaction targets; run lint/build and record local review in `README.md` and `specs/003-staff-dashboard/quickstart.md`.

## Phase 9: Readable internal payment confirmation
- [x] T017 Add dedicated internal alert rendering in `server/staff-receipt.js` and its caller in `server/api.js`, with fixed labelled HTML/text fields and [Paid] subject; preserve receipt callers/recipients/idempotency; verify escaping, masked-card fallback, exact cents and reconciliation in `tests/portal.test.js`; render local mobile/desktop sample and run lint/build/Pages; document preview and limitations in `README.md` and `specs/003-staff-dashboard/quickstart.md`.

## Phase 10: Distinct branded payment confirmations
- [x] T018 Update `server/staff-receipt.js` and paid customer caller in `server/api.js` for distinct branded customer/staff receipts with existing logo/colors/Arial and no staff payment-time row; preserve requests/recipients/idempotency; verify escaping, missing data and dates in `tests/portal.test.js`, show both exact synthetic previews, run tests/lint/build/Pages and document in README/quickstart.

- [x] T019 Refine both receipt headers in `server/staff-receipt.js`: remove USD/STAFF CONFIRMATION labels, match staff/customer navy layout, center amount and add the reference-style check asset (`public/payment-success.svg`/`.png`), include customer/company in staff subject and group displayed amounts; update mail tests, regenerate previews and verify lint/build/mobile rendering.

## Phase 11: Operations foundations
- [x] T020 Define US7–US10 scope, research, model, contracts and release gates in `specs/003-staff-dashboard/`.
- [x] T021 Add additive mail/action/view/export RPCs and service-only guards in `supabase/migrations/202610130004_staff_operations.sql`; extend isolated checks in `scripts/test-database.mjs`.
## Phase 12: Email delivery and receipt recovery
- [x] T022 [US7] Implement raw-body verification, allowlisted events/provider checking, tracked send ledger and delegates in `server/api.js`, `server/email-events.js`, `functions/`; extend mail/history validation in `shared/validation.js` and API tests.
- [x] T023 [US8] Use durable auto receipts and paid-only customer resend in `server/api.js`; test concurrent/replayed/failure receipt behavior in `tests/portal.test.js`.
## Phase 13: Attention and invoice controls
- [x] T024 [US9] Add inquiry-only staff payment check and actionable reasons in `server/api.js`, `src/pages/Dashboard.jsx`; test expired/review/mismatch without auth/capture.
- [x] T025 [US10] Add guarded cancel/replace endpoints, formula-safe filtered CSV in `server/api.js`, `server/csv.js` and staff UI; verify races/replay/totals/filter security.
## Phase 14: Integration and validation
- [x] T026 Update synthetic operations in `scripts/preview.mjs`, compact/mobile styles in `src/index.css`, receipt/history/filter UI in `src/pages/Dashboard.jsx`; verify Chrome/WebKit workflows and old regressions.
- [x] T027 Run tests/isolated DB/lint/build/Pages; record results and webhook release setup in `README.md`, `specs/003-staff-dashboard/quickstart.md`, ignored-secret examples; show local review without deployment.

Order: T021 → T022/T023 → T024/T025 → T026 → T027. Implementation remains sequential in the primary agent; research delegation only.

## Authorized production release
- [x] T028 Verify production baseline, apply and record migrations 002–004, and verify original business fields/grants/RPCs.
- [x] T029 Configure Resend webhook and matching Cloudflare Production secret; preserve existing bindings.
- [x] T030 Commit/push reviewed changes, verify Pages release and safe live reads/webhook checks, record results in quickstart/README.
