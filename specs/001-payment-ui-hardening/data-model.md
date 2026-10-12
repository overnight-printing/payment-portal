# Data Model: Payment UI Hardening

No persisted entities or schema changes are introduced. The feature adds transient view-state models only.

## Payment Link View State

| Field | Values | Rules |
|---|---|---|
| phase | `loading`, `unavailable`, `ready`, `paid` | Exactly one phase is presented at a time. |
| message | controlled user-facing string or empty | Never derived by directly rendering an unexpected exception or response body. |
| retryable | boolean | True for network/malformed-response lookup failures; false for known missing/expired links unless a retry may recover. |
| paymentLink | existing link record or null | Used only after a valid successful response. |

## Payment Field State

| Field | Type | Validation |
|---|---|---|
| expiry | string | `MM/YY`, month 01–12, and not before the current month. |
| cvv | string | Three or four digits; never logged or persisted. |
| zip | string | Five digits. |
| touched | set of field names | A field shows an inline error after blur or submit. |
| errors | map of field name to controlled string | Empty when valid; linked through accessible descriptions. |
| isProcessing | boolean | Blocks duplicate tokenization/charge attempts. |

## Tokenization Attempt

| Field | Type | Rules |
|---|---|---|
| attempt identifier | monotonically changing value | Late messages from an expired attempt do not resolve a new attempt. |
| resolver/rejecter | transient callbacks | Cleared on resolve, reject, timeout, and unmount. |
| timeout handle | transient timer | Cleared on every terminal path. |
| cached token | transient value | Held only in memory, never logged, and cleared when card details are expected to change or component unmounts. |

## Staff Submit Action

| Field | Type | Rules |
|---|---|---|
| action | `link-only` or `send-email` | Derived from the clicked submit button for the current request. |
| sendEmail | boolean | `false` for `link-only`; `true` for `send-email`. Not stored as a pre-submit UI choice. |
| generatedLink | string | Remains selectable after copy success or failure. |
| copyStatus | `idle`, `copied`, `failed` | Announced through a polite live region. |

## Invoice Upload Item

Existing transient fields remain unchanged. The removal action gains a descriptive name based on `filename`; status presentation uses text plus a vector icon rather than color or emoji alone.
