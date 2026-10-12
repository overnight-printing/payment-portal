# Research: Payment UI Hardening

## Decision 1: Preserve the brand and adopt accessible minimalism

- **Decision**: Keep the existing navy, white, and slate brand foundation and single-column customer checkout. Improve semantic color tokens, sizing, focus, whitespace, and hierarchy rather than applying the UI database's unrelated gold/purple palette.
- **Rationale**: The current visual language already conveys trust and matches the merchant logo. UI Pro Max recommends a minimal single-column pattern, one primary action, 44px targets, clear focus, and reduced motion; those recommendations can be applied without rebranding.
- **Alternatives considered**: Full visual rebrand; dark mode; adding a UI component framework. Rejected as unnecessary scope and risk for a payment hardening feature.

## Decision 2: Use dependency-free inline SVG icons

- **Decision**: Add a small shared icon component containing only the required outline icons.
- **Rationale**: This removes platform-dependent emoji, provides consistent stroke/size semantics, and avoids adding a package for a handful of icons.
- **Alternatives considered**: Phosphor or Heroicons dependency; keeping emoji with labels. A library would be reasonable at larger scale but is unnecessary here.

## Decision 3: Validate on blur and submit

- **Decision**: Track touched fields, validate expiration date, security code, and ZIP on blur, and validate all fields on submit. Focus the first invalid field after submit.
- **Rationale**: This provides timely feedback without interrupting typing and matches the UI skill's accessibility and form guidance.
- **Alternatives considered**: Keystroke-only validation; top-level summary only; native validation only. These provide poorer guidance or inconsistent accessible behavior for custom rules.

## Decision 4: Bound tokenizer waits locally

- **Decision**: Give each tokenization attempt a 10-second timer, clear pending resolver state on completion/unmount, and ignore late responses after timeout. The overall success criterion allows up to 12 seconds including UI transition.
- **Rationale**: The hosted iframe can fail silently. A bounded wait prevents an indefinite disabled state while maintaining the existing provider integration.
- **Alternatives considered**: Retrying automatically; reloading the iframe; server-side tokenization. Automatic retry could duplicate provider interactions, and the other options exceed scope.

## Decision 5: Use controlled customer-facing messages

- **Decision**: Parse responses defensively and map status/context to a fixed set of payment and link messages. Unexpected exception text remains out of the UI.
- **Rationale**: HTML error pages, malformed JSON, and provider messages are not appropriate customer copy and may reveal implementation details.
- **Alternatives considered**: Echoing endpoint `message`; exposing status codes. Rejected for safety and clarity.

## Decision 6: Keep API contracts stable

- **Decision**: Make no database or successful endpoint-shape changes. The frontend continues to send existing payloads and accepts existing success fields.
- **Rationale**: All audited improvements can be completed within frontend behavior and styling, minimizing payment regression risk.
- **Alternatives considered**: Standardize error envelopes across all functions. Valuable future work, but it would broaden this task into backend contract migration.

## Decision 7: Preserve two explicit staff outcomes

- **Decision**: Present “Generate link only” as a secondary CTA and “Generate & send email” as the primary CTA. Derive `send_email` directly from the clicked submit button.
- **Rationale**: Staff explicitly requested both outcomes to remain immediately available. Direct submitter-based intent avoids the prior state-ordering race while retaining two fast operational paths.
- **Alternatives considered**: One submit button plus an email checkbox. Rejected by the product owner in favor of two visible actions.

## Decision 8: Use a responsive two-panel staff workspace

- **Decision**: At 1024px and wider, place invoice intake/status in a fixed-minimum left panel and billing details/actions in a flexible right panel. Pair related fields in a two-column form grid. Below 1024px, return to one linear column; below 600px, stack the CTAs.
- **Rationale**: The staff route is an internal throughput tool. On a 2240×1050 viewport the prior 620px card used about 28% of available width while still scrolling. A wider workspace keeps upload context and editable details visible together without changing DOM order.
- **Alternatives considered**: A permanently fixed-height application shell; three columns; hiding optional fields behind disclosure. These would be brittle at increased text size or make review less direct.

## Decision 9: Separate customer review and payment entry on desktop

- **Decision**: Expand only the unpaid customer checkout into two panels at 900px and wider: invoice/trust context on the left and the secure payment form on the right. Keep paid, error, and loading states narrow, and collapse checkout below 900px.
- **Rationale**: The existing 500px checkout is appropriate for mobile but creates a tall desktop form with unused horizontal space. The split preserves a focused sequence while keeping the amount and payment action visible together on common laptop screens.
- **Alternatives considered**: Widening every customer state; compressing helper/error text; making the receipt sticky. Those options either weaken readability, create fragile layout behavior, or add complexity without improving the core task.
