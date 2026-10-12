# Feature Specification: Payment UI Hardening

**Feature Branch**: `001-payment-ui-hardening`

**Created**: 2026-07-20

**Status**: In Progress

**Input**: User description: "Implement the prioritized UI and UX improvements from the payment portal inspection."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recoverable, Safe Customer Payment (Priority: P1)

As a customer opening a payment link, I can understand the invoice, enter payment details efficiently, and recover from missing links, invalid fields, declined payments, tokenizer failures, or network timeouts without seeing internal errors or being left in an indefinite loading state.

**Why this priority**: The customer payment journey is revenue-critical and handles sensitive information. Failures must be safe, understandable, and recoverable.

**Independent Test**: Open valid, missing, expired, and already-paid payment links; exercise empty, malformed, declined, timeout, and duplicate-submission cases; verify each state is keyboard accessible, sanitized, and provides a next step.

**Acceptance Scenarios**:

1. **Given** a missing, expired, or malformed payment-link response, **When** the customer opens the link, **Then** the page shows a customer-safe unavailable message with retry and support guidance and no provider, parser, stack, or response-body details.
2. **Given** an unpaid valid invoice, **When** the customer reviews the page, **Then** the invoice summary, secure-payment context, accepted payment method context, and one primary payment action are clearly presented.
3. **Given** one or more invalid payment fields, **When** the customer leaves a field or submits, **Then** each invalid field has nearby guidance, an announced error relationship, and focus moves to the first invalid field after submit.
4. **Given** tokenization or charge processing exceeds the allowed wait, **When** the timeout occurs, **Then** the form returns to an enabled state and offers a clear retry path without creating a second charge.
5. **Given** a payment is already processing, **When** the customer activates submit again, **Then** no duplicate request is sent and the in-progress state remains clear.
6. **Given** a successful or already-paid invoice, **When** the receipt is displayed on a narrow viewport, **Then** long names, invoice numbers, references, amounts, and email text remain readable without horizontal scrolling.
7. **Given** an unpaid invoice on a desktop viewport at least 900 CSS pixels wide, **When** the customer reviews checkout, **Then** invoice context and secure payment entry appear side by side with the amount, trust information, and payment action visible without unnecessary page scrolling.
8. **Given** the same checkout below 900 CSS pixels or with increased text size, **When** the layout narrows, **Then** invoice context precedes payment entry in one logical column without horizontal overflow or reordered keyboard navigation.

---

### User Story 2 - Efficient Staff Link Creation (Priority: P2)

As a staff member, I can upload invoices, verify extracted details, choose whether to email the customer, and generate a payment link using accessible controls that remain easy to operate on mobile and desktop.

**Why this priority**: Staff efficiency affects every payment link and invoice, while clear review controls reduce customer and amount mistakes.

**Independent Test**: Enter the staff portal, use keyboard and touch-style navigation to upload and remove invoices, edit extracted values, toggle email delivery, submit once, and copy the generated link at 375px and desktop widths.

**Acceptance Scenarios**:

1. **Given** the staff form on a narrow viewport, **When** the user views the primary workflow, **Then** all controls meet minimum touch sizing, helper text remains readable, and the page has no horizontal overflow.
2. **Given** the invoice dropzone is focused, **When** the user presses Enter or Space, **Then** the file chooser opens just as it does for pointer activation.
3. **Given** an uploaded invoice row, **When** a screen-reader or keyboard user reaches its remove control, **Then** the control identifies the invoice by name and has a full-size target.
4. **Given** the completed staff form, **When** the user chooses either “Generate link only” or “Generate & send email,” **Then** the selected action determines email delivery directly, both actions disable during processing, and no second request can race the first.
5. **Given** a generated link, **When** copying succeeds or fails, **Then** the result is announced and the link remains available for manual selection.
6. **Given** the staff portal on a desktop viewport at least 1024 CSS pixels wide, **When** staff review the workflow, **Then** invoice intake and billing details are presented side by side, the primary actions remain visible in a typical laptop-height viewport, and the page uses the available horizontal space without changing keyboard order.
7. **Given** the same staff portal below the desktop breakpoint, **When** the viewport narrows or text size increases, **Then** the workspace returns to a single-column flow with no horizontal scrolling or clipped controls.

---

### User Story 3 - Consistent, Accessible Presentation (Priority: P3)

As any portal user, I experience consistent visual language, readable typography, visible focus, reduced motion when requested, and vector icons rather than platform-dependent emoji.

**Why this priority**: Consistency and accessibility improve trust and usability across both customer and staff journeys.

**Independent Test**: Review both routes at 375px, 768px, 1024px, and 1440px; navigate by keyboard; enable reduced motion; and inspect focus, icon labeling, contrast, wrapping, and control sizes.

**Acceptance Scenarios**:

1. **Given** a keyboard user, **When** focus moves through every interactive control, **Then** each focused control has a visible, consistent focus indicator in logical order.
2. **Given** reduced-motion is enabled, **When** portal states change, **Then** non-essential animations are disabled while progress remains understandable.
3. **Given** any status or action icon, **When** it is rendered, **Then** it uses the shared vector style and does not depend on emoji rendering or color alone.
4. **Given** important body, helper, success, warning, or error text, **When** displayed on its surface, **Then** it meets readable sizing and contrast requirements.

### Edge Cases

- The payment-link endpoint returns HTML, empty content, malformed JSON, a timeout, or a network failure.
- A link is missing, expired, already paid, or opened in two tabs.
- Card tokenization never answers, answers after the local timeout, or reports a provider error.
- A payment is declined or the charge endpoint returns a malformed or non-JSON response.
- A customer submits twice by pointer, keyboard, or rapid activation.
- The secure card iframe has not loaded, loses focus, or cannot be reached by assistive technology.
- Invoice parsing returns missing, ambiguous, mismatched, or malformed values.
- Clipboard permission is unavailable when staff tries to copy a generated link.
- Long invoice numbers, customer/company names, email addresses, filenames, and reference values exceed the usual card width.
- The user enables reduced motion or increases browser text size.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Customer-facing payment-link loading failures MUST use sanitized, actionable messages and MUST NOT display raw response, parser, provider, stack, or infrastructure details.
- **FR-002**: The unavailable-link state MUST provide a retry action and merchant support guidance.
- **FR-003**: The payment form MUST provide nearby field validation for expiration date, security code, and billing ZIP code, with accessible error relationships and submit-time focus on the first invalid field.
- **FR-004**: Payment fields MUST expose appropriate mobile keyboard and autofill hints without persisting sensitive values.
- **FR-005**: Tokenization MUST have a bounded wait, restore the form after timeout, ignore late results for an expired attempt, and provide a retry message.
- **FR-006**: Duplicate payment submission MUST be prevented while a tokenization or charge request is active.
- **FR-007**: Payment status and validation messages MUST be announced without unexpectedly stealing focus.
- **FR-008**: The payment page MUST show concise secure-processing, accepted-card, merchant identity, and support context without making unsupported compliance claims.
- **FR-009**: Staff link generation MUST provide two explicit submit actions: a secondary “Generate link only” action and a primary “Generate & send email” action. The clicked action MUST determine email delivery directly without relying on asynchronous shared-choice state.
- **FR-010**: Staff upload controls MUST support pointer, Enter, and Space activation; invoice removal controls MUST identify their target invoice.
- **FR-011**: Copy-link success and failure MUST be handled and announced accessibly.
- **FR-012**: Interactive controls MUST have at least a 44 by 44 CSS-pixel target, or an equivalent expanded hit area, on narrow viewports.
- **FR-013**: Receipt and invoice content MUST wrap without horizontal page scrolling at 375 CSS pixels and at increased text size.
- **FR-014**: Motion MUST respect the user's reduced-motion preference.
- **FR-015**: Structural and action icons MUST use a consistent inline vector style rather than emoji.
- **FR-016**: Visual tokens MUST cover primary, secondary, success, warning, error, focus, surface, and text roles without undefined custom properties.
- **FR-017**: Required and optional fields MUST be clearly distinguishable using text, not color alone.
- **FR-018**: Loading, error, success, disabled, pressed, hover, and keyboard-focus states MUST remain visually distinct.
- **FR-019**: Existing API request and successful response shapes for payment-link lookup, charge submission, invoice analysis, and link creation MUST remain unchanged.
- **FR-020**: The project quickstart or README MUST document the new manual validation scenarios.
- **FR-021**: The staff workflow MUST use a two-panel desktop layout for invoice intake and billing details at widths of 1024 CSS pixels and above, while preserving a single-column layout below that breakpoint.
- **FR-022**: The staff billing form MAY use paired fields on desktop, but MUST retain DOM and keyboard order as invoice number, amount, customer name, company name, customer email, link-only action, and send-email action.
- **FR-023**: The unpaid customer checkout MUST use a two-panel desktop layout at widths of 900 CSS pixels and above, with invoice/trust context before secure payment entry in DOM order.
- **FR-024**: The customer checkout MUST return to a single-column layout below 900 CSS pixels, and the paid, unavailable, and loading states MUST remain bounded readable cards rather than expanding to the desktop workspace width.
- **FR-025**: The active payment-processing button MUST retain readable contrast while clearly remaining disabled and must continue to announce the existing “Securing payment…” label.

### Key Entities

- **Payment Link View State**: Loading, unavailable, unpaid, processing, paid, and retryable failure states shown to a customer.
- **Payment Field State**: Current value, touched state, validation message, and accessible relationship for each non-tokenized field.
- **Staff Delivery Choice**: Whether a generated link is emailed to the customer or generated for manual sharing.
- **Invoice Upload Item**: Filename, scanning status, sanitized failure or success description, extracted review values, and removal action.

### Security & Privacy Requirements *(mandatory for payment/data changes)*

- **SEC-001**: No raw card number, CVV, payment token, service key, API key, customer secret, or full sensitive provider payload may be logged, persisted, committed, displayed, or returned to the browser.
- **SEC-002**: Environment variables and local secret files MUST remain out of generated artifacts and screenshots.
- **SEC-003**: User-visible errors MUST be derived from a controlled message set and MUST NOT echo unexpected exception text.
- **SEC-004**: UI changes MUST NOT move tokenized card collection out of the existing hosted secure input.
- **SEC-005**: Timeout and retry behavior MUST avoid creating duplicate charge attempts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All interactive controls are keyboard operable with visible focus, and all form/status errors are announced in manual accessibility checks.
- **SC-002**: At 375, 768, 1024, and 1440 CSS pixels, the portal has no horizontal page overflow and every interactive target is at least 44 by 44 CSS pixels or has an equivalent hit area.
- **SC-003**: Every tested missing-link, malformed-response, declined-payment, network-failure, and timeout state presents a sanitized message with a next step and no internal implementation text.
- **SC-004**: Tokenizer non-response exits the processing state within 12 seconds and permits a deliberate retry.
- **SC-005**: Rapid repeated payment activation produces at most one active tokenization or charge request.
- **SC-006**: Browser console review during payment entry and submission contains no card number, CVV, ZIP, payment token, or provider response body.
- **SC-007**: Reduced-motion mode disables non-essential fade, scale, scan, and autofill animations while retaining understandable loading feedback.
- **SC-008**: `npm run lint` and `npm run build` complete successfully, and the feature quickstart scenarios are completed or exact blockers are recorded.
- **SC-009**: At 1440×900 and larger desktop viewports, the empty staff workflow fits within the viewport without vertical page scrolling; at 375px and 768px it has no horizontal overflow and retains at least 44px targets.
- **SC-010**: At 1440×900, the unpaid customer checkout fits without horizontal or vertical page overflow; at 375×812 and 768×900 it remains single-column with no horizontal overflow and a payment action at least 44px high.

## Assumptions

- The existing Overnight Printing Seattle navy palette and Outfit typography remain the brand foundation; this feature improves accessibility and consistency rather than rebranding.
- The existing CardPointe hosted iframe remains the approved card-number collection mechanism.
- Merchant support guidance can use the company's existing public contact channel; no new support backend is required.
- Existing endpoint request and success contracts remain stable; the frontend will defensively handle malformed and failed responses.
- Automated test infrastructure is not introduced solely for this UI change; lint, build, source inspection, and focused browser validation are the minimum verification set.
- Dark mode is outside the current scope because the secure hosted field is explicitly configured for light mode and the current product supports light mode only.

## Visual Upgrade Addendum — 2026-08-21

The existing hardening pass is retained. This follow-up focuses on visual hierarchy and brand clarity without changing payment, upload, or link-generation contracts.

- Customer checkout MUST make the amount due and primary payment action the strongest visual anchors while keeping invoice context before payment entry in source order.
- Staff link creation MUST visually separate invoice intake from billing review, make upload status scannable, and reduce unused desktop space without changing keyboard order.
- The staff two-panel workspace MUST begin at 1200 CSS pixels so narrower or zoomed desktop views keep both workflow stages within the visible canvas.
- Both routes MUST use the existing navy/light-blue brand foundation with stronger surface contrast, less all-caps body labeling, and consistent elevation/radius tokens.
- The visual pass MUST preserve the existing 44px targets, focus styles, reduced-motion behavior, responsive breakpoints, and sanitized status messaging.
- No component library, new font, payment-provider change, or endpoint contract change is in scope.
- Local parser validation MUST use the Pages Functions runtime; Vite-only UI serving is not a valid invoice-analysis environment.
