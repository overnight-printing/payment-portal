import { decimalAmount, moneyCents, escapeHtml, safeText } from '../shared/validation.js';

const logo = 'https://pay.overnightprintingseattle.com/logo.png';
const support = 'contact@overnightprintingseattle.com';

function displayAmount(record) {
  return Number(decimalAmount(moneyCents(record.amount))).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function paymentMethod(record) {
  return /^\d{4}$/.test(record.card_last4 || '') ? `Credit card ending in ${record.card_last4}` : 'Credit card';
}

function details(fields) {
  return `<table aria-label="Payment confirmation details" style="width:100%;border-collapse:collapse;table-layout:fixed;text-align:left">
    ${fields.map(([label, value]) => `<tr><th scope="row" style="width:38%;padding:12px 8px 12px 0;border-bottom:1px solid #d5e0ea;vertical-align:top;font-weight:400;font-size:13px;color:#475569">${escapeHtml(label)}</th><td style="padding:12px 0 12px 8px;border-bottom:1px solid #d5e0ea;vertical-align:top;font-size:15px;font-weight:600;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(value)}</td></tr>`).join('')}
  </table>`;
}

function frame(content, footer) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#edf4fa;font-family:Arial,Helvetica,sans-serif;color:#172033;line-height:1.5"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #d5e0ea;border-radius:12px;table-layout:fixed">
      <tr><td align="center" style="padding:28px 24px"><img src="${logo}" alt="Overnight Printing Seattle" width="260" style="display:block;width:100%;max-width:260px;height:auto;border:0;color:#1e2f66;font-size:18px"></td></tr>
      ${content}
      <tr><td style="padding:20px 24px;font-size:13px;color:#475569;background:#f8fafc;overflow-wrap:anywhere;word-break:break-word">${footer}</td></tr>
    </table>
    <p style="margin:18px 0 0;font-size:12px;color:#475569">Overnight Printing Seattle</p>
  </td></tr></table>`;
}

function paymentHeader(amount) {
  return `<tr><td align="center" style="padding:28px 24px;background:#1e2f66;color:#ffffff;text-align:center">
    <img src="https://pay.overnightprintingseattle.com/payment-success.png" alt="" width="56" height="56" style="display:block;width:56px;height:56px;margin:0 auto 16px;border:0">
    <h1 style="margin:0;font-size:27px;font-weight:400;line-height:1.3">Payment received</h1>
    <p style="margin:12px 0 0;font-size:40px;line-height:1.2;font-weight:700;overflow-wrap:anywhere;word-break:break-word">$${amount}</p>
    </td></tr>`;
}

export function staffReceiptBody(record) {
  const amount = displayAmount(record);
  const customer = safeText(record.customer_name, 400)?.replace(/\s+/g, ' ') || 'Customer';
  const fields = [
    ['Invoice Number(s)', record.order_number],
    ['Amount Paid', `$${amount}`],
    ['Customer / Company', record.customer_name || 'Not recorded'],
    ['Customer Email', record.customer_email || 'Not recorded'],
    ['Payment Method', paymentMethod(record)],
    ['Payment Reference', record.retref || 'Not recorded'],
  ];
  return {
    subject: `[Paid] ${customer} - Invoice #${record.order_number} - $${amount}`,
    text: `Payment received\n\n${fields.map(([label, value]) => `${label}: ${value}`).join('\n')}`,
    html: frame(`${paymentHeader(amount)}<tr><td style="padding:4px 24px 20px">${details(fields)}</td></tr>`, 'Internal payment confirmation'),
  };
}

export function customerReceiptBody(record) {
  const amount = displayAmount(record);
  const fields = [
    ['Invoice Number(s)', record.order_number],
    ['Customer', record.customer_name || 'Not recorded'],
    ['Payment Method', paymentMethod(record)],
    ['Payment Reference', record.retref || 'Not recorded'],
  ];
  if (record.paid_at && Number.isFinite(Date.parse(record.paid_at))) {
    fields.push(['Payment Date', new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric',
    }).format(new Date(record.paid_at))]);
  }
  return {
    subject: `Payment received: Invoice #${record.order_number}`,
    text: `Payment received\n\nAmount Paid: $${amount}\n${fields.map(([label, value]) => `${label}: ${value}`).join('\n')}\n\nThank you for your payment.\nSupport: ${support}`,
    html: frame(`${paymentHeader(amount)}<tr><td style="padding:24px">
      <p style="margin:0 0 8px;font-size:16px;overflow-wrap:anywhere;word-break:break-word">${record.customer_name ? `Hello ${escapeHtml(record.customer_name)},` : 'Hello,'}</p>
      <p style="margin:0 0 20px;font-size:15px;color:#475569">Thank you for your payment.</p>
      <h2 style="margin:0 0 4px;font-size:12px;letter-spacing:1px;color:#37658a">PAYMENT DETAILS</h2>
      ${details(fields)}</td></tr>`, `Questions about your payment?<br><a href="mailto:${support}" style="color:#1e2f66;text-decoration:underline">${support}</a>`),
  };
}
