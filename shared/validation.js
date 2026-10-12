export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CARD_TOKEN = /^9\d{15}$/;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function moneyCents(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = /^(0|[1-9]\d{0,6})(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return cents > 0 && cents <= 100000000 ? cents : null;
}

export function decimalAmount(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function gatewayCents(value) {
  if (typeof value !== 'string') return null;
  if (/^\d+$/.test(value)) {
    const cents = Number(value);
    return Number.isSafeInteger(cents) && cents > 0 && cents <= 100000000 ? cents : null;
  }
  return moneyCents(value);
}

export function safeText(value, max = 200) {
  return typeof value === 'string' && value.trim().length <= max && ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ? value.trim() : null;
}

export function validCardholderName(value) {
  return Boolean(safeText(value, 30));
}

export function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+$/.test(value);
}

export function validExpiry(value, now = new Date()) {
  if (typeof value !== 'string' || !/^(0[1-9]|1[0-2])\d{2}$/.test(value)) return false;
  return new Date(2000 + Number(value.slice(2)), Number(value.slice(0, 2)), 1) > new Date(now.getFullYear(), now.getMonth(), 1);
}

export function invoiceFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = {};
  const warnings = [];
  for (const key of ['order_number', 'customer_name', 'company_name', 'customer_email']) {
    fields[key] = safeText(value[key], key === 'customer_email' ? 254 : 200) || '';
    if (value[key] != null && value[key] !== '' && !fields[key]) warnings.push(`Review ${key.replaceAll('_', ' ')}.`);
  }
  const cents = moneyCents(value.amount);
  fields.amount = cents === null ? '' : decimalAmount(cents);
  if (!fields.order_number || !/^[A-Za-z0-9][A-Za-z0-9 ,./_-]{0,199}$/.test(fields.order_number)) {
    fields.order_number = '';
    warnings.push('Review the invoice number.');
  }
  if (!fields.customer_name) warnings.push('Enter the customer name.');
  if (!validEmail(fields.customer_email)) {
    fields.customer_email = '';
    warnings.push('Enter a valid customer email.');
  }
  if (!fields.amount) warnings.push('Confirm a positive USD amount due.');
  if (value.currency && value.currency !== 'USD') {
    fields.amount = '';
    warnings.push('Only USD invoices are supported.');
  }
  return { ...fields, review_required: true, warnings: [...new Set(warnings)] };
}

export function batchIssue(invoices) {
  if (invoices.some((item) => item.status === 'scanning')) return 'Wait for every invoice to finish reading.';
  if (invoices.some((item) => item.status !== 'success' && !item.reviewed)) return 'Review each incomplete invoice or remove it before generating a link.';
  const parsed = invoices.filter((item) => ['success', 'review'].includes(item.status));
  const identities = parsed.map((item) => item.orderNumber.trim().toLowerCase()).filter(Boolean);
  if (new Set(identities).size !== identities.length) return 'Duplicate invoice numbers found. Remove the duplicate or review a replacement.';
  const mixed = ['customerEmail', 'customerName', 'companyName'].some((field) => new Set(parsed.map((item) => item[field].trim().toLowerCase()).filter(Boolean)).size > 1);
  if (mixed) return 'These invoices belong to different customers. Create a separate link for each customer.';
  return '';
}

export function validPaymentLink(value) {
  return Boolean(value && ['https://fts.cardconnect.com', 'https://fts-uat.cardconnect.com'].includes(value.tokenizer_origin) && UUID.test(value.id) && safeText(value.order_number) && moneyCents(value.amount) !== null &&
    safeText(value.customer_name, 400) && validEmail(value.customer_email) && value.currency === 'USD' &&
    ['pending', 'processing', 'review', 'paid'].includes(value.status) &&
    (value.retref == null || safeText(value.retref, 64) !== null) &&
    (value.card_last4 == null || typeof value.card_last4 === 'string' && /^\d{4}$/.test(value.card_last4)));
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
