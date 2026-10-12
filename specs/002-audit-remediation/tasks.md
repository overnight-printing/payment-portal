# Tasks: Audit Remediation

## Setup and foundation
- [x] T001 Record scope, contracts and rollback in `specs/002-audit-remediation/` before source edits.
- [x] T002 Add shared trust-boundary rules in `shared/validation.js` and focused checks in `tests/`.
- [x] T003 Add additive service-only RPC migration in `supabase/migrations/` and isolated SQL concurrency verification in `scripts/`.
- [x] T004 Share sanitized handlers through `server/api.js`, `server/invoice.js`, `functions/` and `worker/src/index.js`.

## User Story 1: Payment integrity
- [x] T005 [US1] Implement durable claim, canonical charge, full approval validation and safe pending/reconciliation in `server/api.js`.
- [x] T006 [US1] Update provider protocol, separate name-on-card field, mobile security-code containment, bounded loading and unknown-outcome handling in `src/components/PaymentForm.jsx`.
- [x] T007 [US1] Implement lifecycle, response validation, route reset and accessible receipt/status in `src/pages/PaymentPage.jsx`.
- [x] T008 [US1] Verify concurrent, replayed, partial, expired and post-capture failure cases in `tests/` and isolated SQL.

## User Story 2: Staff and invoices
- [x] T009 [US2] Add short-lived HttpOnly sessions, fail-closed login and durable rate limits in `server/api.js` and `functions/staff-session.js`.
- [x] T010 [US2] Validate exact model fields and balance evidence, remove raw output and bound parsing in `server/invoice.js`.
- [x] T011 [US2] Make creation recoverable and email results sanitized/truthful in `server/api.js`.
- [x] T012 [US2] Fix duplicate/mixed/scanning batches, manual corrections, removal reset and session cleanup in `src/pages/CreateLink.jsx`.
- [x] T013 [US2] Bundle maintained PDF.js, bound file/page/pixel resources and preserve reviewed manual attachments in `src/pages/CreateLink.jsx` and `package.json`.
- [x] T014 [US2] Verify session, batch, extraction and creation recovery cases in `tests/`.

## User Story 3: Accessible recovery
- [x] T015 [US3] Add bounded shared fetch/body parsing in `src/lib/api.js` and safe route fallbacks in `src/App.jsx`.
- [x] T016 [US3] Improve contrast, mobile density, long totals and print receipt in `src/index.css`.
- [x] T017 [US3] Add safe static/function headers in `public/_headers` and `server/api.js`.

## User Story 4: Review-only delivery
- [x] T018 [US4] Fix lint ignores, secret variants, pinned tooling, dependency advisories and docs in project configuration and `README.md`.
- [x] T019 [US4] Add synthetic localhost preview and browser review checks in `scripts/`.
- [x] T020 [US4] Run focused checks, `npm run lint`, `npm run build` and desktop/mobile preview; update `specs/002-audit-remediation/quickstart.md`.
- [x] T021 [US4] Map all audit findings to fixes/external prerequisites in `reports/`; show the owner the local preview and migration plan without pushing/deploying.

## Dependencies and execution
T001 → shared validation/migration/handlers → US1 and US2 → UI integration → verification/preview. Sequential work in the shared tree. Focused tests use Node assert/test and an isolated PostgreSQL cluster; no test framework added. Optional research hooks do not change runtime code or trigger approvals/deployment.

- [x] T022 Allow the requested 10-character minimum staff passcode while retaining durable rate limits and short-lived sessions; keep the actual passcode out of source and examples.
- [x] T023 Add safe staff configuration diagnostics in shared backend and sign-in UI; verify missing settings and failed rate-store behavior.
- [x] T024 After explicit owner authorization, inspect production schema and counts, apply the Supabase migration, verify original-field checksum and grants, and confirm live staff sign-in/session/logout.
