# Tasks: Payment UI Hardening

**Input**: Design documents from `/specs/001-payment-ui-hardening/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Lint, build, and focused browser checks from `quickstart.md` are required. No new automated test framework is introduced.

**Organization**: Tasks are grouped by independently testable user story.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm repository and design constraints before source changes.

- [x] T001 Verify ignore patterns and lint coverage for generated/build/secret artifacts in `.gitignore` and `eslint.config.js`
- [x] T002 Record frontend endpoint assumptions and sanitized failure behavior in `specs/001-payment-ui-hardening/contracts/frontend-boundaries.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish shared visual semantics and safety helpers used by all stories.

- [x] T003 Create the dependency-free shared inline SVG icon vocabulary in `src/components/Icon.jsx`
- [x] T004 Define semantic colors, focus rings, minimum control sizing, status styles, responsive rules, and reduced-motion behavior in `src/index.css`
- [x] T005 Remove sensitive token/provider logging and establish controlled client error mapping in `src/components/PaymentForm.jsx`

**Checkpoint**: Shared icon, safety, and styling foundations are ready.

---

## Phase 3: User Story 1 - Recoverable, Safe Customer Payment (Priority: P1) 🎯 MVP

**Goal**: Customers can load, validate, submit, and recover from the payment journey safely and accessibly.

**Independent Test**: Complete Quickstart scenarios 2 and 3 using a valid test link and controlled missing, malformed, decline, timeout, and duplicate-submit states.

- [x] T006 [US1] Add defensive response parsing, sanitized unavailable states, retry, support guidance, and accessible status semantics in `src/pages/PaymentPage.jsx`
- [x] T007 [US1] Add touched field validation, inline errors, accessible relationships, input hints, and first-error focus in `src/components/PaymentForm.jsx`
- [x] T008 [US1] Add bounded tokenization, late-response cleanup, iframe readiness feedback, charge failure mapping, and duplicate-submit prevention in `src/components/PaymentForm.jsx`
- [x] T009 [US1] Add secure-processing and accepted-card context plus responsive receipt semantics in `src/pages/PaymentPage.jsx`
- [x] T010 [US1] Validate customer payment states against scenarios 2 and 3 in `specs/001-payment-ui-hardening/quickstart.md`

**Checkpoint**: Customer payment journey is independently safe and recoverable.

---

## Phase 4: User Story 2 - Efficient Staff Link Creation (Priority: P2)

**Goal**: Staff can upload, review, configure delivery, generate, and copy a link with one accessible workflow.

**Independent Test**: Complete Quickstart scenario 1 with keyboard and narrow-viewport checks.

- [x] T011 [US2] Replace emoji/status controls, add Space-key upload activation, and provide descriptive full-size invoice removal controls in `src/pages/CreateLink.jsx`
- [x] T012 [US2] Provide race-free “Generate link only” and “Generate & send email” submit actions in `src/pages/CreateLink.jsx`
- [x] T013 [US2] Add controlled staff errors, accessible live status, copy failure handling, input hints, and required/optional guidance in `src/pages/CreateLink.jsx`
- [x] T014 [US2] Validate staff keyboard, copy, and responsive workflow against scenario 1 in `specs/001-payment-ui-hardening/quickstart.md`

**Checkpoint**: Staff link creation is independently usable on keyboard, mobile, and desktop.

---

## Phase 5: User Story 3 - Consistent, Accessible Presentation (Priority: P3)

**Goal**: Both routes share a readable, branded, motion-aware visual and interaction system.

**Independent Test**: Complete Quickstart scenario 4 and re-check every interactive control using keyboard navigation.

- [x] T015 [US3] Replace remaining inline presentation styles with semantic classes and shared tokens in `src/pages/PaymentPage.jsx`
- [x] T016 [US3] Replace remaining inline presentation styles with semantic classes and shared tokens in `src/pages/CreateLink.jsx`
- [x] T017 [US3] Finalize responsive wrapping, typography, icon alignment, focus, pressed, disabled, and reduced-motion styles in `src/index.css`
- [x] T018 [US3] Validate responsive receipt, increased text size, visible focus, and reduced motion against scenario 4 in `specs/001-payment-ui-hardening/quickstart.md`

**Checkpoint**: All three stories present one consistent accessible system.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T019 Update behavior and validation guidance in `README.md`
- [x] T020 Run sensitive-output and undefined-token source checks across `src/`
- [x] T021 Run `npm run lint`
- [x] T022 Run `npm run build`
- [x] T023 Run the final desktop/mobile browser smoke test from `specs/001-payment-ui-hardening/quickstart.md`

## Phase 7: Responsive Staff Workspace Amendment

- [x] T024 [US2] Restructure `src/pages/CreateLink.jsx` into semantic invoice-intake and billing-detail panels without changing source order or submit behavior
- [x] T025 [US2] Add a 1024px two-panel workspace, paired desktop fields, and single-column responsive fallbacks in `src/index.css`
- [x] T026 [US2] Update responsive validation guidance in `README.md` and `specs/001-payment-ui-hardening/quickstart.md`
- [x] T027 Run `npm run lint` and `npm run build`
- [x] T028 Validate staff layout at 375×812, 768×900, 1440×900, and 2240×1050 in the browser
- [x] T029 [US2] Equalize desktop panel heights, expand invoice intake into available space, and bottom-align staff CTAs in `src/index.css`
- [x] T030 Re-run lint, build, and desktop/mobile visual checks after the alignment refinement

## Phase 8: Responsive Customer Checkout Amendment

- [x] T031 [US1] Restructure the unpaid state in `src/pages/PaymentPage.jsx` into semantic invoice-context and secure-payment panels without changing endpoint or submit behavior
- [x] T032 [US1] Add a 900px customer checkout workspace and preserve narrow paid/error/loading states plus mobile fallbacks in `src/index.css`
- [x] T033 [US1] Strengthen readable disabled-processing contrast and compact payment-form spacing without removing accessible errors in `src/index.css`
- [x] T034 Update customer responsive validation notes in `README.md` and `specs/001-payment-ui-hardening/quickstart.md`
- [x] T035 Run lint, build, and browser checks for checkout, processing, and paid states at desktop and mobile sizes

## Phase 9: Visual Upgrade Amendment

**Purpose**: Improve hierarchy, workspace density, and brand expression without changing behavior or contracts.

- [x] T036 [US1] Strengthen customer checkout amount hierarchy, step framing, and primary payment action in `src/pages/PaymentPage.jsx` and `src/index.css`
- [x] T037 [US2] Improve staff intake/review density, upload status scanning, and desktop workspace framing in `src/pages/CreateLink.jsx` and `src/index.css`
- [x] T038 [US3] Refine shared brand surfaces, typography, elevation, and responsive spacing in `src/index.css`
- [x] T039 [US3] Update visual validation notes in `README.md` and `specs/001-payment-ui-hardening/quickstart.md`
- [ ] T040 Run `npm run lint`, `npm run build`, and focused desktop/mobile browser previews

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup precedes all source changes.
- Foundational work blocks every user story.
- User Story 1 precedes User Story 3 where both touch `PaymentPage.jsx` and `PaymentForm.jsx` styling.
- User Story 2 precedes User Story 3 where both touch `CreateLink.jsx` styling.
- Polish follows all user stories.

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundation and is independently testable.
- **User Story 2 (P2)**: Starts after Foundation and is independently testable.
- **User Story 3 (P3)**: Integrates the completed customer and staff flows into the shared presentation system.

### Parallel Opportunities

- After T003–T005, customer source work and staff source work affect different page files and can conceptually proceed independently.
- Documentation T019 can proceed independently of final source checks once behavior is stable.
- Execution in this workspace remains sequential because the same shared stylesheet and working tree are used.

## Implementation Strategy

1. Complete setup and safety foundations.
2. Deliver User Story 1 as the payment-safety MVP.
3. Deliver User Story 2 without changing endpoint contracts.
4. Apply cross-page consistency in User Story 3.
5. Complete documentation, lint, build, and browser validation.

## Format Validation

All tasks use the required checkbox, sequential ID, optional story label, exact path, and dependency-ordered format.
