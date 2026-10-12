# Frontend Boundary Contracts

This feature preserves successful endpoint contracts and adds defensive frontend handling for non-successful or malformed responses.

## GET `/payment-link?id={id}`

### Existing success response used by the frontend

```json
{
  "id": "string",
  "order_number": "string",
  "amount": "number-or-decimal-string",
  "customer_name": "string",
  "customer_email": "string",
  "status": "pending-or-paid",
  "retref": "optional-string"
}
```

### Frontend failure contract

- `404`: show the controlled unavailable/expired state.
- Other non-2xx, malformed JSON, HTML, empty body, timeout, or network error: show a controlled temporary-load failure with retry.
- Do not display `message`, `details`, response text, parser errors, or exception strings directly.

## POST `/charge`

### Existing request shape

```json
{
  "token": "hosted-tokenizer-value",
  "amount": "decimal-string",
  "expiry": "MMYY",
  "cvv2": "3-or-4-digit-string",
  "zip": "5-digit-string",
  "paymentLinkId": "string"
}
```

### Existing success response

```json
{
  "success": true,
  "retref": "string"
}
```

### Frontend failure contract

- `400` with already-paid context: invite refresh rather than retrying payment.
- `402`: show a controlled declined-card message and allow correction/retry.
- `404`: show invoice unavailable and prevent another submission.
- `5xx`, malformed JSON, timeout, or network error: show a controlled temporary-processing message and allow deliberate retry.
- Never log or render token, CVV, ZIP, full provider payload, or raw response body.

## POST `/analyze-invoice`

No request or success-shape change. Staff UI continues to consume sanitized fields:

```json
{
  "order_number": "string",
  "amount": "decimal-string",
  "customer_name": "string",
  "company_name": "string",
  "customer_email": "string"
}
```

Failure messages displayed by the staff UI are controlled and must not include raw model/provider content.

## POST `/create-link`

### Existing request fields

`order_number`, `amount`, `customer_name`, `customer_email`, `attachment`, `attachments`, and `send_email` remain unchanged.

### Existing success response

```json
{
  "id": "string",
  "email_sent": true
}
```

The staff UI supplies `send_email: false` from “Generate link only” and `send_email: true` from “Generate & send email.” Intent is derived directly from the clicked submit button.
