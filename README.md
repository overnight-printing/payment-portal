# Payment Portal

A Vite/React payment portal with serverless endpoints for payment links,
charges, and invoice analysis.

## Development

```bash
npm install
npm run dev
```

Before handing off code changes:

```bash
npm run lint
npm run build
```

## Spec Kit Workflow

This repo uses GitHub Spec Kit. For non-trivial work, especially payment,
invoice parsing, link creation, Supabase, worker, or deployment changes:

1. Read `.specify/memory/constitution.md`.
2. Create or update a feature under `specs/` with `$speckit-specify`.
3. Produce `plan.md` with `$speckit-plan`.
4. Produce `tasks.md` with `$speckit-tasks`.
5. Implement from the task list and verify with lint/build.

## Security Baseline

Never commit, log, store, return, or screenshot raw card numbers, CVV values,
payment tokens, service keys, API keys, or customer secrets. Keep secrets in the
appropriate local or deployment environment.
