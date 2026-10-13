import { moneyCents, decimalAmount } from '../shared/validation.js';

function cell(value) {
  const text = String(value ?? '');
  const first = [...text].find((char) => char.charCodeAt(0) > 32 && char.charCodeAt(0) !== 127 && char.trim());
  const safe = first && '=+@-'.includes(first) || text && text.charCodeAt(0) < 32 ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function invoiceCsv(links) {
  const headings = ['Invoice', 'Customer / Company', 'Customer Email', 'Amount', 'Payment Status', 'Link Email', 'Receipt Email', 'Created', 'Paid', 'Link Expires'];
  return '\ufeff' + [headings, ...links.map((link) => [link.order_number, link.customer_name, link.customer_email, decimalAmount(moneyCents(link.amount)), link.payment_status, link.email_status, link.receipt_status, link.created_at, link.paid_at, link.expires_at])].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
