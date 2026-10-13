import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { moneyCents, decimalAmount, validCardholderName, dashboardQuery, UUID } from '../shared/validation.js';
import { parseInvoiceText } from '../server/invoice.js';
import { invoiceCsv } from '../server/csv.js';

const root = resolve('dist');
const port = Number(process.env.PREVIEW_PORT || 5176);
const origin = `http://127.0.0.1:${port}`;
const ids = { checkout: '00000000-0000-4000-8000-000000000001', paid: '00000000-0000-4000-8000-000000000002', processing: '00000000-0000-4000-8000-000000000003', expired: '00000000-0000-4000-8000-000000000004' };
const sample = (id, status = 'pending') => ({ id, tokenizer_origin: origin, order_number: 'DEMO-57548', amount: '37.61', currency: 'USD', customer_name: 'Sample Invoice Customer (Example Printing Co.)', customer_email: 'customer@example.invalid', status, retref: status === 'paid' ? '123456789012' : '', paid_at: status === 'paid' ? new Date().toISOString() : null, receipt_sent: false });
let records;
let creations;
let emails;
function reset() {
  records = new Map([[ids.checkout, sample(ids.checkout)], [ids.paid, sample(ids.paid, 'paid')], [ids.processing, sample(ids.processing, 'processing')], [ids.expired, sample(ids.expired, 'expired')]]);
  for (let i = 0; i < 36; i++) {
    const id = `40000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    const status = ['pending', 'paid', 'pending', 'review', 'expired', 'paid'][i % 6];
    records.set(id, { ...sample(id, status), order_number: `DEMO-${57600 + i}`, customer_name: ['Cascade Coffee', 'Sample Customer', 'Pine Street Studio'][i % 3], customer_email: `${['coffee','sample','studio'][i % 3]}@example.invalid`, amount: decimalAmount(12500 + i * 137), created_at: new Date(Date.UTC(2026, 9, 12, 18) - i * 86400000).toISOString(), email_status: ['accepted', 'delivered', 'bounced', 'unknown', 'pending', 'accepted'][i % 6], receipt_status: status === 'paid' ? i % 12 === 1 ? 'failed' : 'delivered' : 'unknown' });
  }
  creations = new Map(); emails = new Map();
  records.get(ids.paid).receipt_status = 'failed';
  for (const [index, record] of [...records.values()].entries()) {
    const kind = record.status === 'paid' ? 'customer_receipt' : 'payment_link';
    const status = kind === 'customer_receipt' ? record.receipt_status : record.email_status;
    if (!['accepted','delivered','bounced','failed','pending'].includes(status)) continue;
    const request_id = `90000000-0000-4000-8000-${String(index + 1).padStart(12,'0')}`;
    const attemptedAt = kind==='customer_receipt' ? record.paid_at : record.created_at||'2026-10-12T18:00:00Z';
    emails.set(request_id,{request_id,payment_link_id:record.id,kind,state:['delivered','bounced'].includes(status)?'accepted':status,delivery_status:['delivered','bounced'].includes(status)?status:null,can_check:status!=='failed'&&status!=='pending',created_at:attemptedAt,finished_at:status==='pending'?null:attemptedAt});
  }
}
reset();
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; frame-src 'self'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'" };
const navigation = `<aside style="max-width:1600px;margin:8px auto;padding:8px 16px;font:12px Arial;color:#526179"><strong>Local preview · sample data · no live payments or emails</strong> <span>Demo passcode: preview</span></aside>`;
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
    const shape = (r) => {
      const payment_status = r.status === 'pending' ? 'unpaid' : r.status, email_status=r.email_status||'unknown', receipt_status=r.receipt_status||'unknown';
      const attention_reasons=[];
      if(payment_status!=='cancelled') {
        if(['review','processing'].includes(payment_status)) attention_reasons.push(payment_status==='review'?'payment_review':'payment_processing');
        if(payment_status==='expired') attention_reasons.push('link_expired');
        const status=payment_status==='paid'?receipt_status:email_status,prefix=payment_status==='paid'?'receipt':'email';
        if(status==='pending') attention_reasons.push(`${prefix}_unconfirmed`);
        if(['failed','bounced','delayed','suppressed','complained'].includes(status)) attention_reasons.push(`${prefix}_${status}`);
      }
      return { id:r.id,order_number:r.order_number,customer_name:r.customer_name,customer_email:r.customer_email,customer_key:r.customer_email?`email:${r.customer_email.trim().toLowerCase()}`:`link:${r.id}`,amount:r.amount,created_at:r.created_at||null,paid_at:r.paid_at,expires_at:r.expires_at||(r.status==='expired'?'2020-01-01T00:00:00Z':'2099-01-01T00:00:00Z'),payment_status,email_status,receipt_status,last_email_at:r.last_email_at||null,attention_reasons,replaces_link_id:r.replaces_link_id||null,replaced_by:r.replaced_by||null };
    };
    const attention = (l) => l.attention_reasons.length>0;
    const staffRoutes=['/staff-link','/staff-links','/send-link-email','/send-receipt-email','/check-email-status','/check-payment','/cancel-link','/replace-link','/staff-export'];
    if(staffRoutes.includes(url.pathname)&&cookie.includes('preview_session=out'))return json({},401);
    if (url.pathname === '/staff-link') {
      const record=records.get(url.searchParams.get('id'));
      return record?json({link:shape(record),emails:[...emails.values()].filter(e=>e.payment_link_id===record.id).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,20).map(({request_id,kind,state,delivery_status,can_check,created_at,finished_at})=>({request_id,kind,state,delivery_status,can_check,created_at,finished_at}))}):json({},404);
    }
    if(['/send-link-email','/send-receipt-email'].includes(url.pathname)) {
      if(request.headers.origin!==origin)return json({},403);
      const data=await body(request),record=records.get(data.payment_link_id),kind=url.pathname==='/send-receipt-email'?'customer_receipt':'payment_link';
      if(!UUID.test(data.request_id||'')||!UUID.test(data.payment_link_id||''))return json({},400);
      const existing=emails.get(data.request_id);
      if(existing)return existing.payment_link_id===data.payment_link_id&&existing.kind===kind?json({id:record.id,email_status:existing.state,email_sent:existing.state==='accepted'}):json({},409);
      if(!record||shape(record).payment_status!==(kind==='customer_receipt'?'paid':'unpaid'))return json({},409);
      const statusKey=kind==='customer_receipt'?'receipt_status':'email_status';
      if(record[statusKey]==='pending')return json({id:record.id,email_status:'pending',email_sent:false});
      const state=cookie.includes('preview_email=failed')?'failed':'accepted',now=new Date().toISOString();
      emails.set(data.request_id,{request_id:data.request_id,payment_link_id:record.id,kind,state,delivery_status:null,can_check:state==='accepted',created_at:now,finished_at:now});
      record[statusKey]=state;record.last_email_at=now;if(kind==='customer_receipt')record.receipt_sent=state==='accepted';
      return json({id:record.id,email_status:state,email_sent:state==='accepted'});
    }
    if(['/check-email-status','/check-payment','/cancel-link','/replace-link'].includes(url.pathname)) {
      if(request.headers.origin!==origin)return json({},403);
      const data=await body(request),record=records.get(data.payment_link_id);
      if(!record||!UUID.test(data.payment_link_id||''))return json({},404);
      if(url.pathname==='/check-email-status') {
        const email=emails.get(data.email_request_id);
        if(!email||email.payment_link_id!==record.id)return json({},404);
        if(!email.can_check)return json({id:record.id,code:'provider_review',email_status:email.state});
        email.delivery_status='delivered';record[email.kind==='customer_receipt'?'receipt_status':'email_status']='delivered';
        return json({id:record.id,code:'checked',email_status:'delivered'});
      }
      if(url.pathname==='/check-payment')return json({id:record.id,code:record.status==='paid'?'paid':record.status==='pending'?'no_active_attempt':'merchant_review',payment_status:shape(record).payment_status});
      if(url.pathname==='/cancel-link') {
        if(!['pending','expired','cancelled'].includes(record.status))return json({},409);
        record.status='cancelled';return json({id:record.id,cancelled:true});
      }
      if(!UUID.test(data.request_id||''))return json({},400);
      if(record.replaced_by)return json({id:record.replaced_by,replaced_id:record.id});
      if(record.status!=='expired')return json({},409);
      const id=randomUUID();records.set(id,{...sample(id),order_number:record.order_number,amount:record.amount,customer_name:record.customer_name,customer_email:record.customer_email,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+30*86400000).toISOString(),email_status:'not_requested',replaces_link_id:record.id});
      record.status='cancelled';record.replaced_by=id;return json({id,replaced_id:record.id});
    }
    if (['/staff-links','/staff-export'].includes(url.pathname)) {
      const query = dashboardQuery(url.searchParams);
      if (!query) return json({ code: 'invalid_request' }, 400);
      const links = [...records.values()].map(shape).sort((a,b) => (b.created_at||'').localeCompare(a.created_at||'') || b.id.localeCompare(a.id));
      const summary = links.reduce((s,l) => { const state=l.payment_status==='paid'?'paid':l.payment_status==='cancelled'?'cancelled':'unpaid'; s.total++;s[state]++;if(state!=='cancelled')s[`${state}_cents`]+=moneyCents(l.amount);s.sent+=Number(['accepted','delivered'].includes(l.payment_status==='paid'?l.receipt_status:l.email_status));s.attention+=Number(attention(l));return s; },{total:0,paid:0,unpaid:0,cancelled:0,paid_cents:0,unpaid_cents:0,sent:0,attention:0});
      const seattleDate = (d) => d ? new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d)) : '';
      const filtered = links.filter((l) => (query.view==='customers' || !query.search || [l.order_number,l.customer_name,l.customer_email].join(' ').toLowerCase().includes(query.search.toLowerCase())) && (!query.customer||query.customer===l.customer_key) && (!query.start||seattleDate(l.created_at)>=query.start) && (!query.end||seattleDate(l.created_at)&&seattleDate(l.created_at)<=query.end) && (query.payment==='all'||query.payment===l.payment_status||query.payment==='unpaid'&&!['paid','cancelled'].includes(l.payment_status)||query.payment==='attention'&&attention(l)) && (query.email==='all'||query.email==='sent'&&['accepted','delivered'].includes(l.payment_status==='paid'?l.receipt_status:l.email_status)||query.email===(l.payment_status==='paid'?l.receipt_status:l.email_status)||query.email==='unknown'&&(l.payment_status==='paid'?l.receipt_status:l.email_status)==='pending'));
      if(url.pathname==='/staff-export') { if(filtered.length>10000)return json({code:'export_too_large'},413);response.writeHead(200,{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="payment-history.csv"'});response.end(invoiceCsv(filtered));return; }
      if (query.view==='customers') {
        const customers = new Map();
        for(const l of filtered) {
          const c=customers.get(l.customer_key)||{key:l.customer_key,name:l.customer_name||l.customer_email||'Unknown customer',email:l.customer_email,total:0,paid:0,unpaid:0,cancelled:0,paid_cents:0,unpaid_cents:0,last_created_at:l.created_at};
          const state=l.payment_status==='paid'?'paid':l.payment_status==='cancelled'?'cancelled':'unpaid';c.total++;c[state]++;if(state!=='cancelled')c[`${state}_cents`]+=moneyCents(l.amount);customers.set(l.customer_key,c);
        }
        const matched=[...customers.values()].filter((c)=>!query.search||[c.name,c.email].join(' ').toLowerCase().includes(query.search.toLowerCase()));
        return json({summary,total:matched.length,offset:query.offset,limit:query.limit,customers:matched.slice(query.offset,query.offset+query.limit)});
      }
      return json({summary,total:filtered.length,offset:query.offset,limit:query.limit,links:filtered.slice(query.offset,query.offset+query.limit)});
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
      if (request.method === 'GET') { const saved = creations.get(url.searchParams.get('request_id')); return saved ? json(saved) : json({}, 404); }
      const data = await body(request);
      if (!moneyCents(data.amount)) return json({ code: 'invalid_link_details' }, 400);
      const saved = creations.get(data.request_id);
      if (saved) return json(saved);
      const id = randomUUID();
      const result = { id, email_sent: data.send_email && !cookie.includes('preview_email=failed'), email_status: !data.send_email ? 'not_requested' : cookie.includes('preview_email=failed') ? 'failed' : 'accepted' };
      creations.set(data.request_id, result);
      if (data.send_email) { const now = new Date().toISOString(); emails.set(data.request_id,{request_id:data.request_id,payment_link_id:id,kind:'payment_link',state:result.email_status,can_check:result.email_status==='accepted',delivery_status:null,created_at:now,finished_at:now}); }
      records.set(id, { ...sample(id), order_number: data.order_number, amount: decimalAmount(moneyCents(data.amount)), customer_name: data.customer_name, customer_email: data.customer_email, email_status: result.email_status, created_at: new Date().toISOString() });
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
    response.writeHead(200, { ...headers, 'Content-Type': type, ...(type === 'text/html' && url.pathname === '/send' ? { 'Set-Cookie': `preview_email=${url.searchParams.get('email') === 'failed' ? 'failed' : 'accepted'}; HttpOnly; SameSite=Strict; Path=/` } : {}) });
    response.end(content);
  } catch { json({ code: 'preview_request_failed' }, 400); }
});
server.listen(port, '127.0.0.1', () => { console.log(`Local synthetic preview: ${origin}\nCheckout: ${origin}/pay/${ids.checkout}\nNo external payment, email, AI or database services are used.`); });
