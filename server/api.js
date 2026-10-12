import { CARD_TOKEN, UUID, moneyCents, decimalAmount, gatewayCents, safeText, validEmail, validExpiry, validCardholderName, escapeHtml, MAX_FILES, MAX_FILE_BYTES, MAX_ATTACHMENT_BYTES } from '../shared/validation.js';
import { analyzeInvoice } from './invoice.js';

const encoder = new TextEncoder();
const PUBLIC_FIELDS = 'id,order_number,amount,customer_name,customer_email,status,retref,paid_at,card_last4,expires_at,cancelled_at,receipt_sent,link_email_sent';
const SESSION_SECONDS = 3600;
const COOKIE = '__Host-portal_session';

export const securityHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Strict-Transport-Security': 'max-age=31536000',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...securityHeaders, ...headers } });
}

function fail(code, status, message, configurationFields = []) {
  const requestId = crypto.randomUUID();
  if (status >= 500) console.error('Portal request failed', { code, request_id: requestId });
  return json({ code, message, request_id: requestId, ...(configurationFields.length ? { configuration_fields: configurationFields } : {}) }, status);
}

function problem(code = 'service_unavailable', status = 503) {
  const error = new Error(code);
  error.status = status;
  return error;
}

function configurationProblem(fields) {
  return Object.assign(problem('configuration_unavailable'), { configurationFields: fields });
}

async function bounded(operation, milliseconds = 12000, controller = new AbortController()) {
  let timer;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(problem('request_timeout')); }, milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function bodyJson(request, maxBytes = 8192) {
  if (!request.headers.get('Content-Type')?.includes('application/json')) throw problem('invalid_request', 400);
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > maxBytes) throw problem('request_too_large', 413);
  return bounded(async (signal) => {
    const reader = request.body?.getReader();
    if (!reader) throw problem('invalid_request', 400);
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) throw problem('request_too_large', 413);
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let data;
      try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw problem('invalid_request', 400); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw problem('invalid_request', 400);
      return data;
    } finally { signal.removeEventListener('abort', cancel); cancel(); }
  });
}

async function remoteJson(url, options = {}, timeout = 12000) {
  return bounded(async (signal) => {
    const response = await fetch(url, { ...options, signal });
    if (!response.ok) { await response.body?.cancel(); throw problem(); }
    try { return await response.json(); } catch { throw problem(); }
  }, timeout);
}

function config(env, names) {
  const fields = names.filter((name) => typeof env[name] !== 'string' || !env[name]);
  if (!['production', 'development', 'test'].includes(env.APP_ENV)) fields.unshift('APP_ENV');
  if (fields.length) throw configurationProblem(fields);
  if (env.MOCK_PAYMENT === 'true') throw problem('mock_payments_disabled');
}

async function db(env, resource, options = {}) {
  config(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  const url = new URL(`/rest/v1/${resource}`, env.SUPABASE_URL);
  return remoteJson(url, { ...options, headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...options.headers,
  } });
}

async function rpc(env, name, data) {
  return db(env, `rpc/${name}`, { method: 'POST', body: JSON.stringify(data) });
}

async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sameOrigin(request, env) {
  const origin = request.headers.get('Origin');
  const expected = env.PUBLIC_ORIGIN || new URL(request.url).origin;
  if (origin !== expected) throw problem('invalid_origin', 403);
}

async function limit(request, env, action, count = 10, seconds = 60) {
  config(env, ['SESSION_SECRET']);
  if (env.SESSION_SECRET.length < 32) throw configurationProblem(['SESSION_SECRET']);
  const key = `${action}:${await digest(`${env.SESSION_SECRET}:${request.headers.get('CF-Connecting-IP') || 'local'}`)}`;
  if (await rpc(env, 'portal_rate_limit', { p_key: key, p_limit: count, p_window: seconds }) !== true) throw problem('rate_limited', 429);
}

async function signingKey(env) {
  config(env, ['SESSION_SECRET', 'STAFF_PASSCODE']);
  const fields = [['SESSION_SECRET', 32], ['STAFF_PASSCODE', 10]].filter(([name, minimum]) => env[name].length < minimum).map(([name]) => name);
  if (fields.length) throw configurationProblem(fields);
  return crypto.subtle.importKey('raw', encoder.encode(`${env.SESSION_SECRET}:${env.STAFF_PASSCODE}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function cookieName(request) {
  return new URL(request.url).protocol === 'https:' ? COOKIE : 'portal_session';
}

function cookieHeader(request, value, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${cookieName(request)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

async function authenticated(request, env) {
  const key = await signingKey(env);
  const cookie = request.headers.get('Cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName(request)}=`))?.split('=').slice(1).join('=');
  if (!cookie || !/^\d+\.[0-9a-f]{64}$/.test(cookie)) throw problem('unauthorized', 401);
  const [expiry, signature] = cookie.split('.');
  const now = Math.floor(Date.now() / 1000);
  if (Number(expiry) <= now || Number(expiry) > now + SESSION_SECONDS) throw problem('unauthorized', 401);
  const bytes = Uint8Array.from(signature.match(/../g), (hex) => parseInt(hex, 16));
  if (!await crypto.subtle.verify('HMAC', key, bytes, encoder.encode(expiry))) throw problem('unauthorized', 401);
}

async function session(context) {
  const { request, env } = context;
  if (request.method === 'DELETE') { sameOrigin(request, env); return json({ authenticated: false }, 200, { 'Set-Cookie': cookieHeader(request, '', 0) }); }
  if (request.method === 'GET') { await authenticated(request, env); return json({ authenticated: true }); }
  sameOrigin(request, env);
  const key = await signingKey(env);
  try { await limit(request, env, 'login', 5, 300); }
  catch (error) {
    if (error.message === 'service_unavailable') throw problem('staff_rate_limit_unavailable');
    throw error;
  }
  const body = await bodyJson(request, 1024);
  if (typeof body.passcode !== 'string' || body.passcode.length > 200) throw problem('unauthorized', 401);
  // Compare digests so credential length/content do not short-circuit comparison.
  const provided = encoder.encode(await digest(body.passcode));
  const expected = encoder.encode(await digest(env.STAFF_PASSCODE));
  let different = 0;
  for (let index = 0; index < expected.length; index++) different |= provided[index] ^ expected[index];
  if (different) throw problem('unauthorized', 401);
  const expiry = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(expiry)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return json({ authenticated: true }, 200, { 'Set-Cookie': cookieHeader(request, `${expiry}.${signature}`, SESSION_SECONDS) });
}

async function linkRecord(env, id) {
  if (!UUID.test(id || '')) throw problem('invalid_link', 400);
  const query = new URLSearchParams({ id: `eq.${id}`, select: PUBLIC_FIELDS, limit: '1' });
  const rows = await db(env, `payment_links?${query}`);
  const record = rows?.[0];
  if (!record || !['pending', 'paid'].includes(record.status) || moneyCents(record.amount) === null || !safeText(record.order_number) || !safeText(record.customer_name, 400) || !validEmail(record.customer_email)) throw problem('unavailable', 404);
  if (record.status !== 'paid' && (record.cancelled_at || !record.expires_at || !Number.isFinite(Date.parse(record.expires_at)) || Date.parse(record.expires_at) <= Date.now())) throw problem('unavailable', 404);
  return record;
}

function publicLink(record, state = record.status, env) {
  return {
    id: record.id, tokenizer_origin: env.APP_ENV === 'production' ? 'https://fts.cardconnect.com' : 'https://fts-uat.cardconnect.com', order_number: record.order_number, amount: decimalAmount(moneyCents(record.amount)), currency: 'USD',
    customer_name: record.customer_name, customer_email: record.customer_email, status: state,
    retref: typeof record.retref === 'string' ? record.retref : '', card_last4: /^\d{4}$/.test(record.card_last4 || '') ? record.card_last4 : null, paid_at: record.paid_at || null, receipt_sent: record.receipt_sent === true,
  };
}

async function gateway(env, endpoint, body) {
  config(env, ['CARDPOINTE_USER', 'CARDPOINTE_PASS', 'CARDPOINTE_MID']);
  const base = env.APP_ENV === 'production' ? 'https://fts.cardconnect.com' : 'https://fts-uat.cardconnect.com';
  return remoteJson(`${base}/cardconnect/rest/${endpoint}`, {
    method: body ? 'PUT' : 'GET',
    headers: { Authorization: `Basic ${btoa(`${env.CARDPOINTE_USER}:${env.CARDPOINTE_PASS}`)}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, 20000);
}

function fullCapture(result, amount) {
  return result?.respstat === 'A' && /^\d{12}$/.test(result.retref || '') && gatewayCents(result.amount) === moneyCents(amount) && ['Queued for Capture', 'Accepted'].includes(result.setlstat) && (!result.currency || result.currency === 'USD');
}

async function finish(env, attempt, state, reference = null, last4 = null) {
  return rpc(env, 'portal_finish_payment', { p_attempt_id: attempt.id, p_state: state, p_retref: reference, p_last4: last4 });
}

async function reconcile(context, record, attempt) {
  const { env } = context;
  // Never guess from elapsed time or gateway "not found": merchant review releases uncertain outcomes.
  try {
    const result = await gateway(env, `inquireByOrderid/${encodeURIComponent(attempt.order_id)}/${encodeURIComponent(env.CARDPOINTE_MID)}/1`);
    if (fullCapture(result, attempt.amount)) {
      const saved = await finish(env, attempt, 'paid', result.retref);
      if (saved.state === 'paid') {
        const paid = await linkRecord(env, record.id);
        if (!paid.receipt_sent) paid.receipt_sent = await receipts(context, paid);
        return paid;
      }
    }
  } catch { /* Keep the durable claim locked when inquiry/finalization is unavailable. */ }
  return null;
}

async function lookup(context) {
  const { request, env } = context;
  const id = new URL(request.url).searchParams.get('id');
  if (!UUID.test(id || '')) throw problem('invalid_link', 400);
  await limit(request, env, 'lookup', 60);
  let record = await linkRecord(env, id);
  if (record.status === 'paid') return json(publicLink(record, record.status, env));
  const attempts = await db(env, `payment_attempts?${new URLSearchParams({ payment_link_id: `eq.${id}`, state: 'in.(processing,unknown,review)', select: 'id,order_id,amount,state,created_at', limit: '1' })}`);
  const attempt = attempts?.[0];
  if (attempt) {
    if (attempt.state !== 'review' && Date.now() - Date.parse(attempt.created_at) > 60000) record = await reconcile(context, record, attempt) || record;
    return json(publicLink(record, record.status === 'paid' ? 'paid' : attempt.state === 'review' ? 'review' : 'processing', env));
  }
  return json(publicLink(record, record.status, env));
}

async function sendEmail(env, email, identity) {
  if (!env.RESEND_API_KEY) return false;
  try {
    const result = await remoteJson('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': identity }, body: JSON.stringify(email),
    });
    return typeof result?.id === 'string';
  } catch { return false; }
}

function emailBody(record, paid, url) {
  const amount = decimalAmount(moneyCents(record.amount));
  const heading = paid ? 'Payment received' : 'Invoice payment request';
  const date = record.paid_at ? new Date(record.paid_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'short' }) : '';
  const text = `${heading}\nInvoice #${record.order_number}\nCustomer: ${record.customer_name}\nAmount: $${amount} USD\n${paid ? `Reference: ${record.retref}\nPaid: ${date}${record.card_last4 ? `\nCard ending in ${record.card_last4}` : ''}` : `Pay securely: ${url}`}\nSupport: contact@overnightprintingseattle.com`;
  return { subject: `${heading}: Invoice #${record.order_number}`, text,
    html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:auto;padding:24px"><h1>${heading}</h1><p>Hello ${escapeHtml(record.customer_name)},</p><p>Invoice #${escapeHtml(record.order_number)}</p><p><strong>$${amount} USD</strong></p>${paid ? `<p>Reference: ${escapeHtml(record.retref)}</p><p>${escapeHtml(date)}</p>${record.card_last4 ? `<p>Card ending in ${escapeHtml(record.card_last4)}</p>` : ''}` : `<p><a href="${escapeHtml(url)}">Pay invoice securely</a></p>`}<p>Questions? contact@overnightprintingseattle.com</p></div>` };
}

async function receipts(context, record) {
  const customer = await sendEmail(context.env, {
    from: 'Overnight Printing Seattle <accounting@overnightprintingseattle.com>', to: [record.customer_email], ...emailBody(record, true),
  }, `receipt-${record.id}`);
  if (customer) {
    try { await db(context.env, `payment_links?${new URLSearchParams({ id: `eq.${record.id}` })}`, { method: 'PATCH', body: JSON.stringify({ receipt_sent: true }) }); } catch { /* The receipt itself is accepted; status may be repaired by staff. */ }
  }
  const alert = sendEmail(context.env, {
    from: 'Billing Alerts <accounting@overnightprintingseattle.com>', to: ['accounting@overnightprintingseattle.com', 'contact@overnightprintingseattle.com'], ...emailBody(record, true),
  }, `staff-receipt-${record.id}`);
  context.waitUntil?.(alert);
  return customer;
}

async function charge(context) {
  const { request, env } = context;
  sameOrigin(request, env);
  config(env, ['CARDPOINTE_USER', 'CARDPOINTE_PASS', 'CARDPOINTE_MID']);
  await limit(request, env, 'charge', 10);
  const body = await bodyJson(request);
  if (moneyCents(body.amount) === null || !validCardholderName(body.cardholderName) || !UUID.test(body.paymentLinkId || '') || !CARD_TOKEN.test(body.token || '') || !validExpiry(body.expiry) ||
    typeof body.cvv2 !== 'string' || !/^\d{3,4}$/.test(body.cvv2) || typeof body.zip !== 'string' || !/^\d{5}$/.test(body.zip)) throw problem('invalid_payment', 400);
  const record = await linkRecord(env, body.paymentLinkId);
  if (moneyCents(body.amount) !== moneyCents(record.amount)) throw problem('amount_changed', 400);
  const attemptId = crypto.randomUUID();
  const claim = await rpc(env, 'portal_claim_payment', { p_link_id: record.id, p_attempt_id: attemptId, p_order_id: `p${attemptId.replaceAll('-', '').slice(0, 18)}`, p_amount: decimalAmount(moneyCents(record.amount)) });
  if (claim.code === 'paid') return json({ success: true, retref: claim.retref, paid_at: claim.paid_at, receipt_sent: record.receipt_sent === true });
  if (claim.code === 'pending') return json({ success: false, code: 'payment_pending', status: 'processing' }, 202);
  if (claim.code !== 'claimed') throw problem('unavailable', 404);
  const attempt = claim.attempt;
  try {
    const authorization = await gateway(env, 'auth', {
      merchid: env.CARDPOINTE_MID, orderid: attempt.order_id, account: body.token, name: body.cardholderName.trim(),
      amount: decimalAmount(moneyCents(record.amount)), expiry: body.expiry, cvv2: body.cvv2, postal: body.zip, currency: 'USD', capture: 'N',
    });
    if (authorization?.respstat === 'C') {
      await finish(env, attempt, 'declined');
      return fail('card_declined', 402, 'Your card was declined. Review the details or use another card.');
    }
    if (authorization?.respstat !== 'A' || !/^\d{12}$/.test(authorization.retref || '') || gatewayCents(authorization.amount) !== moneyCents(record.amount) || (authorization.currency && authorization.currency !== 'USD')) {
      await finish(env, attempt, authorization?.respstat === 'A' ? 'review' : 'unknown', /^\d{12}$/.test(authorization?.retref || '') ? authorization.retref : null);
      return json({ success: false, code: 'payment_pending', status: 'review' }, 202);
    }
    await finish(env, attempt, 'unknown', authorization.retref, body.token.slice(-4));
    const captured = await gateway(env, 'capture', { merchid: env.CARDPOINTE_MID, retref: authorization.retref, amount: decimalAmount(moneyCents(record.amount)) });
    if (!fullCapture(captured, record.amount) || captured.retref !== authorization.retref) {
      await finish(env, attempt, 'review', authorization.retref);
      return json({ success: false, code: 'payment_pending', status: 'review' }, 202);
    }
    const saved = await finish(env, attempt, 'paid', captured.retref, body.token.slice(-4));
    if (saved.state !== 'paid') throw problem();
    const paid = await linkRecord(env, record.id);
    const receiptSent = await receipts(context, paid);
    return json({ success: true, retref: paid.retref, card_last4: paid.card_last4 || null, paid_at: paid.paid_at, receipt_sent: receiptSent });
  } catch {
    try { await finish(env, attempt, 'unknown'); } catch { /* A failed write leaves the existing claim active. */ }
    return json({ success: false, code: 'payment_pending', status: 'processing' }, 202);
  }
}

function attachments(body) {
  const files = body.attachments || [];
  if (!Array.isArray(files) || files.length > MAX_FILES) throw problem('invalid_attachments', 400);
  let total = 0;
  return files.map((file) => {
    if (!file || !safeText(file.filename, 120) || /[\\/]/.test(file.filename) || !/\.(pdf|png|jpe?g|webp)$/i.test(file.filename) ||
      typeof file.content !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.content) || file.content.length % 4) throw problem('invalid_attachments', 400);
    const size = file.content.length * 3 / 4 - (file.content.endsWith('==') ? 2 : file.content.endsWith('=') ? 1 : 0);
    total += size;
    if (size > MAX_FILE_BYTES || total > MAX_ATTACHMENT_BYTES) throw problem('request_too_large', 413);
    const magic = atob(file.content.slice(0, 24));
    const supported = /\.pdf$/i.test(file.filename) ? magic.startsWith('%PDF-') : /\.png$/i.test(file.filename) ? magic.startsWith('\x89PNG\r\n\x1a\n') : /\.jpe?g$/i.test(file.filename) ? magic.startsWith('\xff\xd8\xff') : magic.startsWith('RIFF') && magic.slice(8, 12) === 'WEBP';
    if (!supported) throw problem('invalid_attachments', 400);
    return { filename: file.filename, content: file.content };
  });
}

async function createLink(context) {
  const { request, env } = context;
  sameOrigin(request, env);
  await authenticated(request, env);
  await limit(request, env, 'create', 20);
  const body = await bodyJson(request, 14500000);
  const amount = moneyCents(body.amount);
  const order = safeText(body.order_number);
  const name = safeText(body.customer_name);
  const company = safeText(body.company_name || '');
  if (!UUID.test(body.request_id || '') || !order || !/^[A-Za-z0-9][A-Za-z0-9 ,./_-]{0,199}$/.test(order) || !amount || !name || company === null || !validEmail(body.customer_email) || typeof body.send_email !== 'boolean') throw problem('invalid_link_details', 400);
  const files = attachments(body);
  const customer = company ? `${name} (${company})` : name;
  const canonical = { order_number: order, amount: decimalAmount(amount), customer_name: customer, customer_email: body.customer_email.trim(), send_email: body.send_email, attachments: files };
  const result = await rpc(env, 'portal_create_link', {
    p_request_id: body.request_id, p_hash: await digest(JSON.stringify(canonical)), p_order_number: order,
    p_amount: decimalAmount(amount), p_customer_name: customer, p_customer_email: canonical.customer_email,
  });
  if (result.code === 'conflict') throw problem('creation_conflict', 409);
  if (!UUID.test(result.link?.id || '')) throw problem();
  const record = result.link;
  let emailSent = record.link_email_sent === true;
  if (body.send_email && !emailSent) {
    const origin = env.PUBLIC_ORIGIN;
    if (!origin || !/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin)) return json({ id: record.id, email_sent: false, email_status: 'failed' });
    emailSent = await sendEmail(env, {
      from: 'Overnight Printing Seattle <accounting@overnightprintingseattle.com>', to: [record.customer_email],
      ...emailBody(record, false, `${origin}/pay/${record.id}`), ...(files.length ? { attachments: files } : {}),
    }, `invoice-link-${record.id}`);
    if (emailSent) {
      try { await db(env, `payment_links?${new URLSearchParams({ id: `eq.${record.id}` })}`, { method: 'PATCH', body: JSON.stringify({ link_email_sent: true }) }); } catch { /* Email accepted; same identity protects immediate retries. */ }
    }
  }
  return json({ id: record.id, email_sent: emailSent, email_status: !body.send_email ? 'not_requested' : emailSent ? 'accepted' : 'failed' });
}

async function invoice(context) {
  sameOrigin(context.request, context.env);
  await authenticated(context.request, context.env);
  await limit(context.request, context.env, 'analysis', 20);
  const body = await bodyJson(context.request, 2100000);
  const result = await bounded(() => analyzeInvoice(body, context.env), 20000);
  if (!result) return fail('invoice_review_required', 422, 'We could not read this invoice. Review the file and enter its details manually.');
  return json(result);
}

export async function handleApi(context) {
  const { request } = context;
  try {
    const url = new URL(request.url);
    if (url.protocol !== 'https:' && (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || context.env.APP_ENV === 'production')) throw problem('invalid_origin', 403);
    const path = url.pathname;
    if (request.method === 'OPTIONS') return fail('method_not_allowed', 405, 'Use a same-origin request.');
    if (path === '/staff-session' && ['GET', 'POST', 'DELETE'].includes(request.method)) return await session(context);
    if (path === '/payment-link' && request.method === 'GET') return await lookup(context);
    if (path === '/charge' && request.method === 'POST') return await charge(context);
    if (path === '/create-link' && request.method === 'GET') {
      await authenticated(request, context.env);
      const requestId = url.searchParams.get('request_id');
      if (!UUID.test(requestId || '')) throw problem('invalid_request', 400);
      await limit(request, context.env, 'recover', 20);
      const records = await db(context.env, `payment_links?${new URLSearchParams({ request_id: `eq.${requestId}`, select: 'id,link_email_sent', limit: '1' })}`);
      if (!records?.[0]) return fail('not_found', 404, 'No link was found for this request.');
      return json({ id: records[0].id, email_sent: records[0].link_email_sent === true });
    }
    if (path === '/create-link' && request.method === 'POST') return await createLink(context);
    if (path === '/analyze-invoice' && request.method === 'POST') return await invoice(context);
    return fail('not_found', 404, 'This endpoint is unavailable.');
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 503;
    const code = ['configuration_unavailable', 'staff_rate_limit_unavailable', 'mock_payments_disabled', 'request_timeout', 'invalid_request', 'request_too_large', 'invalid_origin', 'rate_limited', 'unauthorized', 'invalid_link', 'unavailable', 'invalid_payment', 'amount_changed', 'invalid_attachments', 'invalid_link_details', 'creation_conflict'].includes(error.message) ? error.message : 'service_unavailable';
    const configurationFields = new URL(request.url).pathname === '/staff-session' && code === 'configuration_unavailable' && Array.isArray(error.configurationFields) ? error.configurationFields.filter((name) => ['APP_ENV', 'SESSION_SECRET', 'STAFF_PASSCODE', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].includes(name)) : [];
    return fail(code, status, status === 401 ? 'Your staff session is invalid or expired. Sign in again.' : status === 429 ? 'Too many requests. Wait a few minutes before trying again.' : status >= 500 ? 'This service is temporarily unavailable. Please try again later.' : 'Please review the request or contact the merchant for help.', configurationFields);
  }
}
