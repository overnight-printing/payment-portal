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

## US11 Recent history and visible pagination
- [x] T031 [US11] Specify recent-list date/page contracts and release/validation in specs/003-staff-dashboard/.
- [x] T032 [US11] Add Seattle date helper and focused tests in src/lib/history.js and tests/history.test.js; reuse backend query validation.
- [x] T033 [US11] Add date presets/custom dates, page sizes/counts/controls, URL state and drilldown preservation in src/pages/Dashboard.jsx and src/index.css.
- [x] T034 [US11] Run focused browser date/pagination/mobile checks and npm test/lint/build; update README.md and specs/003-staff-dashboard/quickstart.md, then push/deploy authorized refinement.

- [x] T035 [US11] Add bounded numbered pagination/helper assertions in src/lib/history.js and tests/history.test.js; center accessible controls in src/pages/Dashboard.jsx and src/index.css, verify mobile/jumps and publish checked refinement.

## US12 UI/UX cleanup
- [x] T036 [US12] Install/read upstream UI/UX Pro Max, inspect existing components/controls/assets and define retained rules in specs/003-staff-dashboard/.
- [x] T037 [US12] Consolidate control sizing/tokens/layout in src/index.css and presentation-only wrappers/icons in src/components/StaffShell.jsx, src/components/Icon.jsx, src/pages/Dashboard.jsx and src/pages/CreateLink.jsx.
- [x] T038 [US12] Verify responsive/accessibility geometry and existing functional flows with synthetic browser checks, run npm test/lint/build, update README.md/quickstart and publish the verified cleanup.

- [x] T039 [US12] Consolidate payment filters and list counts in src/pages/Dashboard.jsx/src/index.css; verify all statuses, pagination/accessibility/mobile and lint/build/tests, document results and release.

## US13 One-day staff session
- [x] T040 [US13] Add session-lifetime contract/plan and focused clock-boundary assertions in tests/portal.test.js.
- [x] T041 [US13] Update shared session lifetime in server/api.js, document re-login requirement in README.md/quickstart, verify test/lint/build and Pages compilation, push and verify release.

## US14 Cleanup and drawer dismissal
- [x] T042 [US14] Inspect complete production history/active attempts, freeze cutoff, cancel eligible stale unpaid records through existing guarded RPC and verify retained records/paid data.
- [x] T043 [US14] Add safe backdrop dismissal in src/pages/Dashboard.jsx, verify synthetic desktop/mobile/drag/busy/Escape/focus and test/lint/build, document and deploy.

## US15 Twenty-invoice batch
- [x] T044 [US15] Amend batch contracts and add focused 20/21-file, byte-boundary, email/replay assertions in tests/portal.test.js.
- [x] T045 [US15] Raise shared MAX_FILES and UI message, verify synthetic 20-file selection/drop and existing batch guards, update README/quickstart, run test/lint/build/Pages compile and deploy.

## US16 Shared-company AR batches
- [x] T046 [US16] Reproduce real PDF intake; add parser and shared-company batch regression tests in tests/portal.test.js.
- [x] T047 [US16] Fix shared batch matching, confirmed-total/recipient defaults and partial-row feedback in shared/validation.js, server/invoice.js and src/pages/CreateLink.jsx.
- [x] T048 [US16] Verify actual 12 PDFs and synthetic edge/mobile/20-file workflows, run test/lint/build/Pages compile, document and deploy.

## US17 Consecutive customer batches
- [x] T049 [US17] Reproduce stale prior result and add focused synthetic browser assertions for consecutive batches and original recovery locks.
- [x] T050 [US17] Reuse reset in src/pages/CreateLink.jsx for next upload/Send another, verify browsers/test/lint/build, document and deploy.

## US18 Full-width sending and optional contacts
- [x] T051 [US18] Add API/public validation and isolated SQL optional-contact, direct-send, payment and receipt regression checks.
- [x] T052 [US18] Update frontend layout/action validation, shared/server contact handling and optional-contact SQL function; keep preview/contracts consistent.
- [x] T053 [US18] Verify desktop/mobile/contactless checkout/reset and test/lint/build/Pages/isolated DB; apply migration with data/grant checks and deploy.

## US19 Readable results and compact payment URLs
- [x] T054 [US19] Add canonical full-UUID compact-path helper and focused codec/email regression tests in `shared/payment-link.js` and `tests/portal.test.js`.
- [x] T055 [US19] Simplify result/form copy and hierarchy in `src/pages/CreateLink.jsx` and `src/index.css`; preserve warning, clipboard and reset states.
- [x] T056 [US19] Use short paths across `src/App.jsx`, `src/pages/PaymentPage.jsx`, `src/pages/Dashboard.jsx`, `src/pages/CreateLink.jsx`, and `server/api.js`; keep old routes and UUID API contracts.
- [x] T057 [US19] Verify mobile/desktop, clipboard, email states and legacy/short checkout in browser checks; run required gates, update README/quickstart and deploy.

## US20 Customer checkout readability
- [x] T058 [US20] Rework invoice hierarchy and consistent customer form in `src/pages/PaymentPage.jsx`, `src/components/PaymentForm.jsx` and `src/index.css`.
- [x] T059 [US20] Fix hosted CSS inset/height reset and realistic sample-only preview in `src/components/PaymentForm.jsx`, `scripts/preview.mjs` and `tests/preview.test.js`; verify sanitizer/empty hosted geometry.
- [x] T060 [US20] Add focused checkout browser checks in `scripts/verify-checkout.mjs`, run required gates, update README/quickstart and deploy with screenshot proof.

## US21 Send existing invoices from sidebar
- [x] T061 [US21] Add transactional recipient-and-claim migration `supabase/migrations/202610280006_link_email_contacts.sql`; cover SQL replay/race/history/grants in `scripts/test-database.mjs`.
- [x] T062 [US21] Extend shared send boundary in `server/api.js`, `specs/003-staff-dashboard/contracts/staff-dashboard.md`, `scripts/preview.mjs`, and `tests/portal.test.js` with validated optional contact fields and existing-URL sends.
- [x] T063 [US21] Add inline recipient composer and guarded recovery in `src/pages/Dashboard.jsx` and `src/index.css`; verify browser flows in `scripts/verify-invoice-email.mjs`.
- [x] T064 [US21] Run required checks, document README/quickstart, apply safe production migration and deploy; show synthetic desktop/mobile proof.
