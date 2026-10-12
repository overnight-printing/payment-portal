# Quickstart: Payment UI Hardening Validation

## Prerequisites

- Node dependencies installed.
- A local environment capable of serving the same-origin functions for full endpoint checks, or a documented mock/staging environment.
- Do not enter, record, or screenshot real card details, CVV, payment tokens, customer secrets, or production credentials.

## Build gates

```bash
npm run lint
npm run build
```

## Local UI

```bash
npm run dev
```

Use Vite alone only for UI styling work; it does not serve `functions/` and
will return a failed `/analyze-invoice` request.

## Scenario 1: Staff accessibility and mobile layout

1. Open `/` and verify the passcode screen uses an `h1`, labeled input, 44px controls, and visible keyboard focus.
2. After authorized entry, test at widths 375, 768, 1024, and 1440 CSS pixels.
3. Confirm no horizontal page scrolling and no helper/status text below 12px.
4. Focus the upload zone and activate it with Enter and Space.
5. Verify upload, status, warning, logout, and remove visuals use consistent SVG icons.
6. Confirm every remove button has a descriptive accessible name and at least a 44px target.
7. Confirm “Generate link only” is secondary, “Generate & send email” is primary, both are at least 44px high, and they stack on narrow screens.
8. Activate each action independently and verify the request uses the corresponding `send_email` value while both actions remain disabled during processing.
9. Generate a link and verify copy success or failure is announced.
10. At 1440×900 and 2240×1050, confirm invoice intake is left of billing details, the empty workflow does not vertically scroll, and both CTAs remain visible.
11. At 1023px, 768px, and 375px, confirm the workspace collapses to one column with invoice intake before billing details, no horizontal overflow, and logical keyboard order.

## Scenario 2: Payment field validation

1. Open a valid unpaid `/pay/{id}` link in a non-production test environment.
2. Confirm merchant, secure-processing, accepted-card, invoice, and amount context are visible.
3. Leave expiration, CVV, and ZIP fields invalid and blur each field.
4. Verify nearby error text appears, the field exposes an invalid state and description, and submission focuses the first invalid field.
5. Confirm numeric mobile keyboard hints and appropriate autocomplete hints are present.
6. Confirm the card-number label is programmatically connected to the secure-field group.
7. At 1440×900, confirm invoice/trust context appears left of payment entry, the full checkout fits without page overflow, and the pay action remains visible.
8. At 899px, 768px, and 375px, confirm the checkout returns to one column with review context before the form and no horizontal overflow.

## Scenario 3: Recovery and duplicate prevention

1. Open missing and expired links; verify a sanitized message, retry, and support guidance.
2. Return HTML, malformed JSON, or an empty body from payment-link lookup; verify no parser or response text is displayed.
3. Simulate a tokenizer that does not respond; verify processing ends within 12 seconds and retry is available.
4. Rapidly activate payment submit; verify at most one tokenization/charge attempt is active.
5. Simulate decline, network failure, and malformed charge response; verify controlled guidance and an enabled retry path.
6. Inspect the browser console and confirm it contains no token, CVV, ZIP, raw provider result, or raw response body.

## Scenario 4: Responsive receipt and reduced motion

1. Test unpaid and paid views with long invoice, name, company, email, and reference values at 375px.
2. Confirm rows wrap and the page does not scroll horizontally.
3. Enable `prefers-reduced-motion: reduce` and verify fade, scale, scan, and autofill animations are disabled while loading indicators remain understandable.
4. Increase browser text size and confirm labels, helper text, alerts, and actions remain operable.

## Validation Record — 2026-07-20

- `npm run lint`: PASS.
- `npm run build`: PASS.
- Staff portal rendered at 375px and 1440px: PASS; no horizontal overflow, nested interactive controls, or visible target below 44px.
- Two staff CTAs at 375px: PASS; “Generate link only” and “Generate & send email” stack at 290px wide by 46px high, expose distinct submit values, and produce no horizontal overflow.
- Responsive staff workspace amendment: PASS at 375×812, 768×900, 1440×900, and 2240×1050. The two-panel layout activates at 1200px, desktop form fields pair into two columns, smaller viewports remain single-column, and no tested width has horizontal overflow.
- Desktop fit: PASS at 1440×900 and 2240×1050; the empty staff workflow has no vertical page overflow and both CTAs remain visible. Mobile/tablet retain expected vertical scrolling for the linear workflow.
- Desktop panel alignment: PASS at 2240×1050; invoice intake and billing details share a 452px height and baseline, the dropzone expands to 330px, and the action row is bottom-aligned. The 375×812 fallback remains one column without horizontal overflow.
- Customer checkout workspace: PASS at 1440×900; invoice context and payment entry render in 402px and 492px equal-height panels, the full page fits without overflow, and the 46px pay action remains visible. At 768×900 and 375×812 the flow returns to one column with no horizontal overflow.
- Customer terminal states: PASS; the paid receipt remains a bounded 500px card at desktop width, and disabled/processing payment styling retains white text on a solid navy-muted surface instead of relying on opacity alone.
- Passcode screen heading and control sizing: PASS; input 46px, show/hide control 44px, submit 46px.
- Malformed local payment-link response: PASS; controlled retry/support state shown with `role="alert"` and no parser/HTML details.
- Reduced-motion rule, accessible descriptions, field invalid states, live regions, input modes, and autocomplete hints: PASS by source and rendered-DOM inspection.
- Full valid-link tokenization, decline, charge-timeout, already-paid receipt, invoice upload, link creation, and clipboard integration require the configured same-origin Pages Functions and a non-production test link. The Vite-only local server does not provide those services; these remain deployment-environment smoke checks and no real payment or customer data was used locally.

## Visual Upgrade Review — 2026-08-21

- Customer checkout: confirm the header badge, Step 1/Step 2 hierarchy, and total-due surface remain readable at 1440×900, 768×900, and 375×812.
- Staff workspace: confirm the branded header, framed intake/review panels, uploaded-invoice count, and primary/secondary action hierarchy remain visible without horizontal overflow at 1440×900 and 375×812; confirm the workspace is single-column below 1200px.
- Shared styling: confirm labels remain readable sentence case, focus rings and 44px targets are unchanged, and the navy/light-blue surfaces retain readable contrast.

Validation status: `npm run lint` and `npm run build` pass. Browser screenshots
were not captured in this session because the connected browser became
unavailable after the local environment reset; T040 remains open for that
focused visual check.
