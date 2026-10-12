import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { moneyCents, decimalAmount, validCardholderName } from '../shared/validation.js';
import { parseInvoiceText } from '../server/invoice.js';

const root = resolve('dist');
const port = Number(process.env.PREVIEW_PORT || 5176);
const origin = `http://127.0.0.1:${port}`;
const ids = { checkout: '00000000-0000-4000-8000-000000000001', paid: '00000000-0000-4000-8000-000000000002', processing: '00000000-0000-4000-8000-000000000003', expired: '00000000-0000-4000-8000-000000000004' };
const sample = (id, status = 'pending') => ({ id, tokenizer_origin: origin, order_number: 'DEMO-57548', amount: '37.61', currency: 'USD', customer_name: 'Sample Invoice Customer (Example Printing Co.)', customer_email: 'customer@example.invalid', status, retref: status === 'paid' ? '123456789012' : '', paid_at: status === 'paid' ? new Date().toISOString() : null, receipt_sent: false });
let records;
let creations;
function reset() { records = new Map([[ids.checkout, sample(ids.checkout)], [ids.paid, sample(ids.paid, 'paid')], [ids.processing, sample(ids.processing, 'processing')]]); creations = new Map(); }
reset();
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; frame-src 'self'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'" };
const navigation = `<aside style="max-width:1240px;margin:12px auto;padding:10px 16px;background:#fff;border:1px solid #b7cde0;border-radius:10px;font:14px system-ui;color:#172033"><strong>Local preview · sample data · no payments or emails</strong><nav style="display:flex;gap:14px;flex-wrap:wrap;margin-top:8px"><a href="/pay/${ids.checkout}">Checkout</a><a href="/pay/${ids.paid}">Receipt</a><a href="/pay/${ids.processing}">Payment processing</a><a href="/pay/${ids.expired}">Expired link</a><a href="/">Staff</a><a href="/?email=failed">Email failure example</a></nav><small>Choose “Select sample card” in checkout. Staff sign-in, if shown, uses <b>preview</b>.</small></aside>`;
const frame = `<!doctype html><html><body style="margin:0;font:14px system-ui"><button id="sample" style="min-height:38px;width:100%;border:0;border-radius:4px;color:#1e2f66;background:#edf4fa;font:inherit;cursor:pointer">Select sample card</button><script>document.getElementById('sample').onclick=function(){this.textContent='Sample card selected';parent.postMessage(JSON.stringify({token:'9'.padEnd(16,'0'),errorCode:'0'}),location.origin)};</script></body></html>`;
async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 14500000) throw new Error('too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, origin);
  const cookie = request.headers.cookie || '';
  const json = (data, status = 200, extra = {}) => { response.writeHead(status, { ...headers, 'Content-Type': 'application/json', ...extra }); response.end(JSON.stringify(data)); };
  try {
    if (url.pathname === '/demo/reset') { reset(); return json({ reset: true }); }
    if (url.pathname === '/staff-session') {
      if (request.method === 'DELETE') return json({ authenticated: false }, 200, { 'Set-Cookie': 'preview_session=out; HttpOnly; SameSite=Strict; Path=/' });
      if (request.method === 'POST') { const data = await body(request); return data.passcode === 'preview' ? json({ authenticated: true }, 200, { 'Set-Cookie': 'preview_session=in; HttpOnly; SameSite=Strict; Path=/' }) : json({ authenticated: false }, 401); }
      return cookie.includes('preview_session=out') ? json({ authenticated: false }, 401) : json({ authenticated: true });
    }
    if (url.pathname === '/payment-link') {
      const record = records.get(url.searchParams.get('id'));
      return record ? json(record) : json({ code: 'unavailable' }, 404);
    }
    if (url.pathname === '/charge' && request.method === 'POST') {
      const data = await body(request);
      const record = records.get(data.paymentLinkId);
      if (!record || !validCardholderName(data.cardholderName)) return json({ code: 'invalid_payment' }, 400);
      if (record.status === 'processing') return json({ success: false, code: 'payment_pending' }, 202);
      const paid = { ...record, status: 'paid', retref: '123456789012', paid_at: new Date().toISOString(), receipt_sent: false };
      records.set(record.id, paid);
      return json({ success: true, retref: paid.retref, paid_at: paid.paid_at, receipt_sent: false });
    }
    if (url.pathname === '/analyze-invoice' && request.method === 'POST') {
      const data = await body(request);
      return json(data.text ? parseInvoiceText(data.text) : { order_number: 'DEMO-57548', amount: '37.61', customer_name: 'Sample Invoice Customer', company_name: 'Example Printing Co.', customer_email: 'customer@example.invalid', review_required: true, warnings: [] });
    }
    if (url.pathname === '/create-link') {
      if (request.method === 'GET') { const saved = creations.get(url.searchParams.get('request_id')); return saved ? json({ id: saved.id, email_sent: saved.email_sent }) : json({}, 404); }
      const data = await body(request);
      if (!moneyCents(data.amount)) return json({ code: 'invalid_link_details' }, 400);
      const saved = creations.get(data.request_id);
      if (saved) return json(saved);
      const id = randomUUID();
      const result = { id, email_sent: data.send_email && !cookie.includes('preview_email=failed'), email_status: !data.send_email ? 'not_requested' : cookie.includes('preview_email=failed') ? 'failed' : 'accepted' };
      creations.set(data.request_id, result);
      records.set(id, { ...sample(id), order_number: data.order_number, amount: decimalAmount(moneyCents(data.amount)), customer_name: data.customer_name, customer_email: data.customer_email });
      return json(result);
    }
    if (url.pathname === '/itoke/ajax-tokenizer.html') { response.writeHead(200, { ...headers, 'X-Frame-Options': 'SAMEORIGIN', 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'self'" }); response.end(frame); return; }
    const file = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + sep) && file !== root) return json({}, 404);
    let content;
    let type;
    try {
      if (!(await stat(file)).isFile()) throw new Error();
      content = await readFile(file);
      type = ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html' })[extname(file)] || 'application/octet-stream';
    } catch { content = await readFile(resolve(root, 'index.html')); type = 'text/html'; }
    if (type === 'text/javascript') content = content.toString().replaceAll('https://fts-uat.cardconnect.com', origin).replaceAll('https://fts.cardconnect.com', origin);
    if (type === 'text/html') content = content.toString().replace('<body>', `<body>${navigation}`);
    response.writeHead(200, { ...headers, 'Content-Type': type, ...(type === 'text/html' && url.pathname === '/' ? { 'Set-Cookie': `preview_email=${url.searchParams.get('email') === 'failed' ? 'failed' : 'accepted'}; HttpOnly; SameSite=Strict; Path=/` } : {}) });
    response.end(content);
  } catch { json({ code: 'preview_request_failed' }, 400); }
});
server.listen(port, '127.0.0.1', () => { console.log(`Local synthetic preview: ${origin}\nCheckout: ${origin}/pay/${ids.checkout}\nNo external payment, email, AI or database services are used.`); });
