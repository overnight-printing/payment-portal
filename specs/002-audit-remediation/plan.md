# Implementation Plan: Audit Remediation

**Date**: 2026-10-12 | **Spec**: [spec.md](spec.md) | **Branch**: existing working tree; no commits/push/deployment

## Summary
Keep React/CSS and both existing deployment entrypoints. Share validated backend handlers, use database row locks and durable attempts for payment/creation recovery, strengthen staff sessions, validate invoice batches and improve local review UX.

## Technical Context
JavaScript ES modules, React 19, Vite 8, Cloudflare Pages Functions/Worker, Web Crypto and fetch; Supabase PostgREST + PostgreSQL RPCs. Bundle maintained PDF.js with a matching worker. Use Node's built-in test runner/asserts and isolated PostgreSQL 17 from Postgres.app. Local preview uses synthetic services and cannot send real financial/email requests.

## Constitution Check
Pre-design PASS: spec before source changes; no payment credentials persisted/logged; API contracts and migration explicit; lint/build and focused regressions required; unknown financial outcomes remain locked. Post-design PASS: both backend entrypoints delegate to one implementation, schemas protect concurrent clients, no live credentials or data required for preview. Remote schema/auth/provider validation remains a release prerequisite.

## Project Structure
- `shared/validation.js`: pure money/field/invoice/batch rules used by frontend and backend.
- `server/api.js`, `server/invoice.js`: shared handlers and invoice extraction; sanitized HTTP helpers and expiring sessions.
- `functions/`: thin maintained Pages entrypoints; `worker/src/index.js`: route adapter to identical handlers.
- `supabase/migrations/`: transactional RPCs, financial attempts, creation identities and durable rate buckets with service-only grants/RLS.
- `src/lib/api.js`, existing pages/form/styles: deadlines, explicit status handling, staff sessions, review and accessibility.
- `tests/`, `scripts/`: focused security/money regressions and synthetic localhost preview.
- `public/_headers`, configuration/examples/docs: security headers, reproducible tools and review prerequisites.

## Implementation Decisions
A row lock on an invoice plus a unique active financial attempt gates all gateway calls. Definite declines release the attempt; timeouts, malformed approval or failed finalization remain unresolved and cannot start a second attempt. Gateway inquiry may resolve existing approved/declined attempts; unsupported/partial outcomes require merchant review.
Creation uses a stable client request UUID and validated payload identity; email delivery is independent of record insertion and retries use a stable email idempotency key. Notification result copy distinguishes accepted, failed and not-requested.
Staff passcodes of at least 10 characters are accepted only by a bounded login endpoint; a short-lived signed HttpOnly cookie replaces browser credential storage. Durable hashed-IP login rate limits work across instances; individual SSO is a deployment identity integration still to verify.
Keep old paid/pending database statuses; derive processing/review-needed status from financial attempts rather than breaking existing enum constraints. Add 30-day link expiry and explicit cancellation. New schema is tested in a fresh local PostgreSQL cluster, never on existing databases.

## Migration and rollback
Staff sign-in diagnostics return only allowlisted configuration names and a separate rate-limit service error; React renders fixed instructions rather than raw provider output. Authentication and rate limits still fail closed.
Prepare an additive transaction; verify existing columns/status constraints and migration preconditions before release. If migration/configuration is missing, financial/staff writes fail closed. Do not revert to the old non-idempotent charge path with unresolved attempts. Roll back serving while retaining attempts and money history; reconcile through the gateway before any new attempt.

## Complexity Tracking
No constitution exceptions. Shared handlers remove duplicated backend business logic; database operations are explicit RPCs, not a repository/framework layer. Optional product features remain outside this repair.
