# Dashboard Data Model

## Payment link
Existing ID/invoice/customer/email/amount/created_at/status/paid_at/expiry/cancellation remain intact. New `link_email_status` text is NOT NULL, default unknown, constrained to unknown/not_requested/pending/accepted/failed. Backfill only true `link_email_sent` to accepted. Unknown → not_requested for link-only; unknown/failed → pending before attempting email; pending → accepted or failed. Recorded accepted/true can never be downgraded by backend retries. Pending is an unresolved send outcome, not proof of failure.

## Dashboard snapshot
`summary`: total, paid, unpaid counts and paid_cents/unpaid_cents integer USD totals across all links. `total`: filtered count. `offset`, `limit`: requested bounded page. `links`: allowlisted ID, order_number, customer_name/email (nullable), amount decimal string, created_at/paid_at (nullable), payment_status and email_status. No payment tokens, attempt order IDs, card fields, gateway details or keys.

Payment status precedence: paid; active review; active processing/unknown; cancelled; expired/missing expiry; unpaid. Search/filter operates on this projection. Unpaid includes all non-paid states; totals are link history, not unique invoices or receivables.

## Staff workspace additions
Customer key: email:<normalized email>, otherwise link:<uuid>. Aggregates exact cents per stored link, not assumed receivables. Date filters on created_at in America/Los_Angeles. Email request: UUID PK, payment_link_id FK, pending/accepted/failed, created_at and finished_at. Pending partial unique index per link. Replay is terminal or unconfirmed; no duplicate provider action. Accepted updates ever-accepted boolean; latest attempt drives row email status. Detail includes last20 attempts and expiry, with no invented historical timestamps.

Operations additions: portal_link_emails.kind (payment_link/customer_receipt/staff_receipt), provider_id (unique optional UUID), recipients (recorded array), delivery_status (optional accepted/delayed/delivered/bounced/failed/complained/suppressed). Send state remains pending/accepted/failed, unique pending per invoice+kind. portal_email_events stores request_id,event_id,recipient,status,occurred_at only; dedupe event+recipient and terminal precedence preserve outcomes. No bodies/tokens/secrets persisted. payment_links.replaces_link_id unique successor FK; originals cancelled atomically. View includes separate receipt status, attention reasons and successor relationships. Overall/customer total includes paid+unpaid+cancelled; outstanding excludes cancelled. Export max10,000 allowlisted filtered rows.
