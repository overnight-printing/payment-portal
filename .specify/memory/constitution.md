# Payment Portal Constitution

## Core Principles

### I. Payment Safety Is Non-Negotiable
The portal MUST never log, persist, echo, or expose raw card numbers, CVV values,
payment tokens, customer secrets, API keys, Supabase service keys, or Wrangler
secrets. Client code may collect payment inputs only long enough to hand them to
the approved payment flow. Serverless code must sanitize errors before returning
JSON to the browser and before writing logs.

### II. Spec-First Changes
User-facing payment, invoice parsing, link creation, database, worker, or
deployment changes MUST start from a Spec Kit feature under `specs/`. A feature
needs `spec.md`, `plan.md`, and `tasks.md` before implementation unless the
change is a trivial typo or dependency-only maintenance task. Specs must include
acceptance scenarios, edge cases, security/privacy requirements, and rollback or
failure behavior.

### III. Contract Boundaries Stay Explicit
Each change must name the boundary it touches: React UI in `src/`, Netlify-style
functions in `functions/`, Cloudflare Worker code in `worker/src/`, Supabase
access in `src/lib/supabase.js`, and environment configuration. API request and
response shapes must be documented in the spec or contracts, including error
payloads. Frontend assumptions may not drift from function/worker behavior.

### IV. Test And Build Gates
Any code change must pass `npm run lint` and `npm run build` before it is
considered done. Payment, invoice parsing, or link-generation changes must also
include the most focused manual or automated verification available in the
feature quickstart. If a gate cannot run because of missing credentials or local
service limits, the final handoff must state the exact skipped command and why.

### V. Production-Like Failure Handling
Features must define behavior for invalid invoices, missing or expired links,
network failures, declined payments, duplicate submissions, partial Supabase
writes, and worker/function timeouts. The UI must make failures recoverable
without leaking internal implementation details.

## Project Constraints

- Primary app stack: Vite, React, React Router, Supabase client, serverless
  functions under `functions/`, and Cloudflare Worker code under `worker/`.
- Secrets belong in environment-specific secret stores or ignored local env
  files, never in committed source, generated specs, logs, or screenshots.
- UI work must preserve responsive behavior and accessible form labels, focus
  states, validation messages, and keyboard submission paths.
- Invoice analysis must treat model output as untrusted: validate structure,
  sanitize strings, and handle missing/ambiguous invoice fields explicitly.
- Payment links must be idempotent where practical and must not rely on hidden
  client-only state for amount, invoice, customer, or status decisions.

## Development Workflow

1. For non-trivial work, create or update a Spec Kit feature with
   `$speckit-specify`, `$speckit-plan`, and `$speckit-tasks`.
2. Run the constitution check during planning and again before implementation.
3. Keep each task tied to an exact file path and user story so work does not
   become an untracked grab bag.
4. Before handoff, run `npm run lint` and `npm run build`.
5. Update README, quickstart, or operational notes whenever behavior, setup, or
   deployment expectations change.

## Governance

This constitution supersedes informal agent habits for this repository. Changes
to payment handling, storage, API contracts, security posture, or deployment
workflow require a spec update and a short migration or rollback note. Template
updates should strengthen these rules rather than dilute them.

**Version**: 1.0.0 | **Ratified**: 2026-06-26 | **Last Amended**: 2026-06-26
