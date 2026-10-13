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
  if (invoices.some((item) => !['success', 'review'].includes(item.status) || item.status === 'review' && !item.attachment)) return 'Remove unreadable files before generating a link.';
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

export const EMAIL_STATES = ['accepted', 'delivered', 'bounced', 'failed', 'delayed', 'suppressed', 'complained', 'pending', 'not_requested', 'unknown'];
export const EMAIL_KINDS = ['payment_link', 'customer_receipt', 'staff_receipt'];
export const ATTENTION_REASONS = ['payment_processing', 'payment_review', 'link_expired', 'email_unconfirmed', 'email_failed', 'email_bounced', 'email_suppressed', 'email_complained', 'email_delayed', 'receipt_unconfirmed', 'receipt_failed', 'receipt_bounced', 'receipt_suppressed', 'receipt_complained', 'receipt_delayed'];

export function dashboardQuery(params) {
  if ([...params.keys()].some((key) => !['search', 'payment', 'email', 'offset', 'limit', 'start', 'end', 'customer', 'view'].includes(key) || params.getAll(key).length !== 1)) return null;
  const search = safeText(params.get('search') || '', 100);
  const payment = params.get('payment') || 'all';
  const email = params.get('email') || 'all';
  const offset = params.get('offset') ?? '0';
  const limit = params.get('limit') ?? '25';
  const start = params.get('start') || '', end = params.get('end') || '';
  const date = (d) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d) && Number(d.slice(0, 4)) > 0 && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().startsWith(d);
  const customer = safeText(params.get('customer') || '', 300);
  const view = params.get('view') || 'links';
  if (search === null || !['all', 'paid', 'unpaid', 'processing', 'review', 'expired', 'cancelled', 'attention'].includes(payment) || !['all', 'sent', ...EMAIL_STATES].includes(email) || !/^\d{1,6}$/.test(offset) || Number(offset) > 100000 || !/^\d{1,2}$/.test(limit) || Number(limit) < 1 || Number(limit) > 50 || !date(start) || !date(end) || start && end && start > end || customer === null || !['links', 'customers'].includes(view)) return null;
  return { search, payment, email, offset: Number(offset), limit: Number(limit), start, end, customer, view };
}

export function validStaffLink(link) {
  const date = (d) => d == null || typeof d === 'string' && Number.isFinite(Date.parse(d));
  return Boolean(link && UUID.test(link.id) && typeof link.order_number === 'string' &&
    (link.customer_name == null || typeof link.customer_name === 'string') && (link.customer_email == null || typeof link.customer_email === 'string') &&
    moneyCents(link.amount) !== null && date(link.created_at) && date(link.paid_at) && date(link.expires_at) && date(link.last_email_at) &&
    ['paid', 'unpaid', 'processing', 'review', 'expired', 'cancelled'].includes(link.payment_status) && EMAIL_STATES.includes(link.email_status) && (link.receipt_status === undefined || EMAIL_STATES.includes(link.receipt_status)) &&
    [link.replaces_link_id, link.replaced_by].every((id) => id == null || UUID.test(id)) && (link.attention_reasons === undefined || Array.isArray(link.attention_reasons) && link.attention_reasons.length <= ATTENTION_REASONS.length && link.attention_reasons.every((reason) => ATTENTION_REASONS.includes(reason))));
}

export function validStaffDetail(value) {
  return Boolean(value && validStaffLink(value.link) && Array.isArray(value.emails) && value.emails.length <= 20 && value.emails.every((email) => UUID.test(email.request_id) && ['pending', 'accepted', 'failed'].includes(email.state) && (email.kind === undefined || EMAIL_KINDS.includes(email.kind)) && (email.delivery_status == null || ['accepted', 'delivered', 'bounced', 'failed', 'delayed', 'suppressed', 'complained'].includes(email.delivery_status)) && (email.can_check === undefined || typeof email.can_check === 'boolean') && typeof email.created_at === 'string' && Number.isFinite(Date.parse(email.created_at)) && (email.finished_at == null || typeof email.finished_at === 'string' && Number.isFinite(Date.parse(email.finished_at)))));
}

export function validDashboard(value) {
  const integer = (n) => Number.isSafeInteger(n) && n >= 0;
  const date = (d) => d == null || typeof d === 'string' && Number.isFinite(Date.parse(d));
  const rows = value?.customers || value?.links;
  return Boolean(value && value.summary && ['total', 'paid', 'unpaid', 'paid_cents', 'unpaid_cents'].every((key) => integer(value.summary[key])) && ['sent', 'attention'].every((key) => value.summary[key] === undefined || integer(value.summary[key]) && value.summary[key] <= value.summary.total) && (value.summary.cancelled === undefined || integer(value.summary.cancelled)) && value.summary.total === value.summary.paid + value.summary.unpaid + (value.summary.cancelled || 0) &&
    integer(value.total) && value.total <= value.summary.total && integer(value.offset) && value.offset <= 100000 && integer(value.limit) && value.limit >= 1 && value.limit <= 50 &&
    Array.isArray(rows) && rows.length <= value.limit && (value.customers ? rows.every((customer) => customer && typeof customer.key === 'string' && typeof customer.name === 'string' && (customer.email == null || typeof customer.email === 'string') && ['total', 'paid', 'unpaid', 'paid_cents', 'unpaid_cents'].every((key) => integer(customer[key])) && (customer.cancelled === undefined || integer(customer.cancelled)) && customer.total === customer.paid + customer.unpaid + (customer.cancelled || 0) && date(customer.last_created_at)) : rows.every(validStaffLink)));
}
