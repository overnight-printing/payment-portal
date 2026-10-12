# Implementation Plan: Payment UI Hardening

**Branch**: `001-payment-ui-hardening` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-payment-ui-hardening/spec.md`

## Summary

Harden the customer payment and staff link-creation interfaces by removing sensitive client logging, adding bounded tokenizer/network recovery, providing field-level accessible validation, presenting two explicit race-free staff submission actions, replacing emoji controls with shared inline SVG icons, and establishing responsive/reduced-motion styling. Both active workflows use space-efficient desktop workspaces: the customer route separates invoice context from secure payment entry at 900px and wider, while the staff route separates invoice intake from billing review at 1024px and wider. Both collapse to linear mobile flows without changing source or keyboard order. Existing successful endpoint request and response contracts remain unchanged; frontend response parsing becomes defensive and user-visible failures come from a controlled message set.

## Technical Context

**Language/Version**: JavaScript ES modules, React 19.2, Vite 8

**Primary Dependencies**: React, React Router, Supabase JS, Vite; existing CardPointe hosted tokenizer; existing Cloudflare Pages Functions

**Storage**: No schema or persistence changes. Existing payment link records remain the source of invoice status and amount.

**Testing**: `npm run lint`, `npm run build`, focused browser checks from `quickstart.md` at 375/768/1024/1440px, keyboard navigation, reduced motion, and controlled fetch/tokenizer failure scenarios where locally available

**Target Platform**: Modern mobile and desktop browsers

**Project Type**: Single React payment portal with same-origin serverless endpoints

**Performance Goals**: Immediate control feedback; no duplicate active submit; tokenizer attempt completes or fails within 12 seconds; no layout shift from status feedback; empty staff workflow fits without page scrolling at 1440×900 and larger viewports

**Constraints**: Hosted iframe continues collecting card number; no sensitive console output; sanitized UI errors; unchanged successful endpoint contracts; 44px minimum targets; light theme only

**Scale/Scope**: Three frontend files plus shared stylesheet, one small icon component, README/feature documentation; no database, worker, deployment, or provider migration

## Constitution Check

### Pre-Design Gate

- **Payment Safety**: PASS. The feature removes token logging, keeps card-number collection hosted, and prohibits sensitive output in UI and console.
- **Spec-First Changes**: PASS. `spec.md`, this plan, contracts, quickstart, and tasks are created before source edits.
- **Contract Boundaries**: PASS. `contracts/frontend-boundaries.md` records all touched frontend/backend assumptions; successful request and response shapes remain unchanged.
- **Test and Build Gates**: PASS. Lint, build, and focused manual checks are mandatory tasks.
- **Production-Like Failure Handling**: PASS. Missing/expired links, malformed responses, tokenizer timeout, decline, network failure, duplicate submit, and copy failure have specified UI behavior.

### Post-Design Gate

- No new secret handling, persistence, dependencies, or external data transfer is introduced.
- Customer-visible errors are selected locally rather than echoing unexpected response or exception text.
- The frontend still sends the existing charge payload only after hosted tokenization succeeds.
- Manual verification includes mobile, keyboard, assistive status semantics, and reduced motion.
- **Result**: PASS; no constitution exceptions or complexity justifications are required.

### Responsive Workspace Amendment

- The desktop change touches only React structure and shared CSS; endpoint and persistence contracts remain unchanged.
- Source order stays linear for keyboard and assistive technology even when CSS Grid presents two visual panels.
- Widths below 1024px collapse to one column, and widths below 600px retain stacked CTAs and compact card padding.

### Customer Checkout Workspace Amendment

- Only the unpaid checkout expands; paid, unavailable, and loading states retain their bounded card width.
- At 900px and wider, invoice/trust context is visually separated from secure payment entry while DOM order remains review-first.
- Below 900px, the page uses the existing single-column sequence and retains the existing hosted-card boundary and submit behavior.

## Project Structure

### Documentation (this feature)

```text
specs/001-payment-ui-hardening/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── frontend-boundaries.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── components/
│   ├── Icon.jsx                 # shared inline SVG icon vocabulary
│   └── PaymentForm.jsx          # safe tokenization and accessible validation
├── pages/
│   ├── CreateLink.jsx           # staff workflow and two explicit submit actions
│   └── PaymentPage.jsx          # defensive link loading and recovery
└── index.css                    # tokens, responsive states, reduced motion

functions/                       # contracts inspected; no response-shape change
README.md                        # behavior and validation notes
```

**Structure Decision**: Keep the existing single-project layout. Add one dependency-free icon component and consolidate view styling in `src/index.css`; do not add a component library or change serverless boundaries for this frontend hardening pass.

## Complexity Tracking

No constitution violations require justification.

## Visual Upgrade Amendment — 2026-08-21

Keep the existing React/CSS architecture. Update `src/pages/PaymentPage.jsx`,
`src/pages/CreateLink.jsx`, and `src/index.css` only for stronger hierarchy,
denser workspace composition, and clearer brand surfaces. Do not add a UI
library, change endpoint contracts, or move sensitive payment collection.
