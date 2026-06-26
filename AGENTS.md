# Agent Instructions

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan.
<!-- SPECKIT END -->

## Repository Rules

- Use Spec Kit for non-trivial changes: create or update `specs/<feature>/`
  before editing payment flows, invoice parsing, link creation, Supabase access,
  serverless functions, worker behavior, or deployment configuration.
- Read `.specify/memory/constitution.md` before planning or implementing.
- Keep API contracts explicit between `src/`, `functions/`, `worker/src/`, and
  Supabase. Do not let frontend assumptions silently diverge from backend
  responses.
- Never log, store, commit, or display raw card numbers, CVV values, payment
  tokens, service keys, API keys, or customer secrets.
- Run `npm run lint` and `npm run build` before marking code work complete. If a
  command cannot run locally, report the exact blocker.

## Project Map

- Frontend pages: `src/pages/PaymentPage.jsx`, `src/pages/CreateLink.jsx`
- Payment form UI: `src/components/PaymentForm.jsx`
- Supabase client: `src/lib/supabase.js`
- Serverless functions: `functions/charge.js`, `functions/create-link.js`,
  `functions/payment-link.js`, `functions/analyze-invoice.js`
- Cloudflare Worker: `worker/src/index.js`, `worker/wrangler.toml`
- Styling: `src/App.css`, `src/index.css`

## Quality Bar

- Payment and link flows must handle duplicate submissions, missing links,
  expired links, declined payments, network errors, and sanitized error output.
- Invoice parsing must validate model output before trusting it.
- UI changes must preserve mobile layout, labels, focus behavior, accessible
  errors, and keyboard operation.
- Behavior changes should update README or the relevant Spec Kit quickstart.
