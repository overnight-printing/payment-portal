# Data Model

## Payment link
Existing UUID, order number, exact USD amount, customer name/email, pending/paid status, paid date and reference. Add request UUID + payload hash for creation recovery, expiry and cancellation timestamps, and notification acceptance state. Public response allowlists identity, invoice, amount/currency, customer strings, effective status, paid date/reference and receipt acceptance.

## Financial attempt
UUID, invoice UUID, unique gateway order ID, amount, state (`processing`, `unknown`, `paid`, `declined`, `review`), reference, masked last four digits and timestamps. No full token/PAN/CVV or cardholder name is stored. One active processing/unknown/review attempt per invoice. Row-lock claim checks canonical amount, pending status, expiry and cancellation. Approved exact full amount can finalize atomically; definite decline releases; ambiguous/partial outcomes remain blocked. No raw card/token/CVV storage.

## Staff session
Signed short-lived cookie with expiry and no passcode/customer payload. Signature uses environment-managed session secret. Login buckets use salted IP digest, fixed time windows and atomic counts; no raw IP/passcode persistence. Missing configuration fails closed.

## Reviewed batch
Readable bounded attachments and independently validated extraction results. Duplicate invoice IDs/content hashes or different recipients block submission. Manually edited fields persist through scans; all removal resets derived values. Partial/manual attachments require explicit review.
