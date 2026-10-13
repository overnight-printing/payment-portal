import { CARD_TOKEN, UUID, moneyCents, decimalAmount, gatewayCents, safeText, validEmail, validExpiry, validCardholderName, escapeHtml, MAX_FILES, MAX_FILE_BYTES, MAX_ATTACHMENT_BYTES, dashboardQuery, validDashboard, validStaffDetail, validStaffLink } from '../shared/validation.js';
import { analyzeInvoice } from './invoice.js';
import { staffReceiptBody, customerReceiptBody } from './staff-receipt.js';
import { verifyWebhook, deliveryStates } from './email-events.js';
import { invoiceCsv } from './csv.js';

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

async function bodyText(request, maxBytes = 8192) {
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
      try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw problem('invalid_request', 400); }
    } finally { signal.removeEventListener('abort', cancel); cancel(); }
  });
}

async function bodyJson(request, maxBytes = 8192) {
  let data;
  try { data = JSON.parse(await bodyText(request, maxBytes)); } catch (error) { if (error.status) throw error; throw problem('invalid_request', 400); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw problem('invalid_request', 400);
  return data;
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

async function staffRecord(env, id) {
  if (!UUID.test(id || '')) throw problem('invalid_link', 400);
  const query = new URLSearchParams({ id: `eq.${id}`, select: PUBLIC_FIELDS, limit: '1' });
  const rows = await db(env, `payment_links?${query}`);
  const record = rows?.[0];
  if (!record || !['pending', 'paid'].includes(record.status) || moneyCents(record.amount) === null || !safeText(record.order_number) || !safeText(record.customer_name, 400) || !validEmail(record.customer_email)) throw problem('unavailable', 404);
  return record;
}

async function linkRecord(env, id) {
  const record = await staffRecord(env, id);
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
    if (fullCapture(result, attempt.amount) && (!attempt.retref || result.retref === attempt.retref)) {
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
  const attempts = await db(env, `payment_attempts?${new URLSearchParams({ payment_link_id: `eq.${id}`, state: 'in.(processing,unknown,review)', select: 'id,order_id,amount,state,created_at,retref', limit: '1' })}`);
  const attempt = attempts?.[0];
  if (attempt) {
    if (attempt.state !== 'review' && Date.now() - Date.parse(attempt.created_at) > 60000) record = await reconcile(context, record, attempt) || record;
    return json(publicLink(record, record.status === 'paid' ? 'paid' : attempt.state === 'review' ? 'review' : 'processing', env));
  }
  return json(publicLink(record, record.status, env));
}

async function sendEmail(env, email, identity) {
  let outcome = { state: 'failed', provider_id: null };
  if (env.RESEND_API_KEY) try {
    outcome = await bounded(async (signal) => {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal, headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': identity }, body: JSON.stringify(email),
      });
      if (!response.ok) { await response.body?.cancel(); return { state: response.status >= 500 || [408, 409].includes(response.status) ? 'pending' : 'failed', provider_id: null }; }
      const result = await response.json();
      return UUID.test(result?.id || '') ? { state: 'accepted', provider_id: result.id } : { state: 'pending', provider_id: null };
    });
  } catch { outcome = { state: 'pending', provider_id: null }; }
  return outcome;
}

function emailBody(record, url) {
  const amount = decimalAmount(moneyCents(record.amount));
  const heading = 'Invoice payment request';
  const text = `${heading}\nInvoice #${record.order_number}\nCustomer: ${record.customer_name}\nAmount: $${amount} USD\nPay securely: ${url}\nSupport: contact@overnightprintingseattle.com`;
  return { subject: `${heading}: Invoice #${record.order_number}`, text,
    html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:auto;padding:24px"><h1>${heading}</h1><p>Hello ${escapeHtml(record.customer_name)},</p><p>Invoice #${escapeHtml(record.order_number)}</p><p><strong>$${amount} USD</strong></p><p><a href="${escapeHtml(url)}">Pay invoice securely</a></p><p>Questions? contact@overnightprintingseattle.com</p></div>` };
}

async function automaticReceiptId(id, kind) {
  const hash = await digest(`initial:${kind}:${id}`);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

async function receipts(context, record) {
  let customer = record.receipt_sent === true;
  if (!customer) try {
    const result = await emailLink(context, record.id, await automaticReceiptId(record.id, 'customer_receipt'), [], 'customer_receipt');
    customer = result.email_sent;
  } catch { /* Confirmed payment stays paid even if notification storage is unavailable. */ }
  const alert = (async () => emailLink(context, record.id, await automaticReceiptId(record.id, 'staff_receipt'), [], 'staff_receipt'))().catch(() => false);
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
  if (body.send_email && !record.link_email_sent) return json(await emailLink(context, record.id, body.request_id, files));
  if (!body.send_email && !record.link_email_sent) await db(env, `payment_links?${new URLSearchParams({ id: `eq.${record.id}`, link_email_status: 'eq.unknown' })}`, { method: 'PATCH', body: JSON.stringify({ link_email_status: 'not_requested' }) });
  return json({ id: record.id, email_sent: record.link_email_sent === true, email_status: body.send_email ? 'accepted' : 'not_requested' });
}

async function emailLink(context, id, requestId, files = [], kind = 'payment_link') {
  const { env } = context;
  const claim = await rpc(env, 'portal_claim_email', { p_request_id: requestId, p_link_id: id, p_kind: kind });
  if (claim.code === 'unavailable' || claim.code === 'conflict') throw problem('email_unavailable', 409);
  let state = claim.state;
  if (claim.code === 'claimed') {
    let outcome = { state: 'failed', provider_id: null };
    let providerStarted = false;
    try {
      const record = await staffRecord(env, id);
      const isLink = kind === 'payment_link';
      const origin = env.PUBLIC_ORIGIN;
      const eligible = isLink ? record.status === 'pending' && !record.cancelled_at && Date.parse(record.expires_at) > Date.now() && /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin || '') : record.status === 'paid';
      if (eligible) {
        const email = {
          from: kind === 'staff_receipt' ? 'Billing Alerts <accounting@overnightprintingseattle.com>' : 'Overnight Printing Seattle <accounting@overnightprintingseattle.com>',
          to: kind === 'staff_receipt' ? ['accounting@overnightprintingseattle.com', 'contact@overnightprintingseattle.com'] : [record.customer_email],
          ...(isLink ? emailBody(record, `${origin}/pay/${id}`) : kind === 'staff_receipt' ? staffReceiptBody(record) : customerReceiptBody(record)),
          tags: [{ name: 'portal_app', value: 'payment_portal' }, { name: 'portal_request', value: requestId }, { name: 'portal_link', value: id }, { name: 'portal_kind', value: kind }],
          ...(isLink && files.length ? { attachments: files } : {}),
        };
        providerStarted = true;
        outcome = await sendEmail(env, email, `portal-email-${requestId}`);
      }
    } catch { if (providerStarted) outcome = { state: 'pending', provider_id: null }; }
    try { state = (await rpc(env, 'portal_finish_email', { p_request_id: requestId, p_state: outcome.state, p_provider_id: outcome.provider_id })).state; }
    catch { state = 'pending'; }
  } else if (!['existing', 'pending'].includes(claim.code)) throw problem();
  if (!['pending', 'accepted', 'failed'].includes(state)) throw problem();
  return { id, email_status: state, email_sent: state === 'accepted' };
}

async function sendLinkEmail(context, kind = 'payment_link') {
  const body = await staffAction(context, ['payment_link_id', 'request_id']);
  return json(await emailLink(context, body.payment_link_id, body.request_id, [], kind));
}

async function staffAction(context, keys) {
  sameOrigin(context.request, context.env);
  await authenticated(context.request, context.env);
  await limit(context.request, context.env, new URL(context.request.url).pathname, 10);
  const body = await bodyJson(context.request);
  if (Object.keys(body).some((key) => !keys.includes(key)) || keys.some((key) => !UUID.test(body[key] || ''))) throw problem('invalid_request', 400);
  return body;
}

async function webhook(context) {
  config(context.env, ['RESEND_WEBHOOK_SECRET']);
  if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(context.env.RESEND_WEBHOOK_SECRET)) throw configurationProblem(['RESEND_WEBHOOK_SECRET']);
  const raw = await bodyText(context.request, 32768);
  let verified;
  try { verified = await verifyWebhook(context.request, raw, context.env.RESEND_WEBHOOK_SECRET); }
  catch { throw problem('invalid_webhook', 400); }
  if (verified.event) {
    const event = verified.event;
    await rpc(context.env, 'portal_record_email_event', { p_event_id: verified.event_id, p_provider_id: event.provider_id, p_request_id: event.request_id, p_link_id: event.link_id, p_kind: event.kind, p_recipients: event.recipients, p_status: event.status, p_occurred_at: event.occurred_at });
  }
  return json({ received: true });
}

async function checkEmail(context) {
  const body = await staffAction(context, ['payment_link_id', 'email_request_id']);
  const rows = await db(context.env, `portal_link_emails?${new URLSearchParams({ request_id: `eq.${body.email_request_id}`, payment_link_id: `eq.${body.payment_link_id}`, select: 'request_id,payment_link_id,kind,state,provider_id,recipients', limit: '1' })}`);
  const email = rows?.[0];
  if (!email) throw problem('unavailable', 404);
  if (!UUID.test(email.provider_id || '') || email.kind === 'staff_receipt') return json({ id: body.payment_link_id, code: 'provider_review', email_status: email.state });
  config(context.env, ['RESEND_API_KEY']);
  const result = await remoteJson(`https://api.resend.com/emails/${email.provider_id}`, { headers: { Authorization: `Bearer ${context.env.RESEND_API_KEY}` } });
  const tags = Array.isArray(result.tags) ? Object.fromEntries(result.tags.map((tag) => [tag.name, tag.value])) : {};
  if (result.id !== email.provider_id || !Array.isArray(result.to) || !Array.isArray(email.recipients) || result.to.length !== email.recipients.length || !result.to.every((to) => email.recipients.includes(to)) ||
    tags.portal_app !== 'payment_portal' || tags.portal_request !== email.request_id || tags.portal_link !== email.payment_link_id || tags.portal_kind !== email.kind) throw problem();
  const status = deliveryStates[result.last_event];
  if (!status) return json({ id: body.payment_link_id, code: 'no_delivery_update', email_status: email.state });
  const outcome = await rpc(context.env, 'portal_record_email_event', { p_event_id: `check_${crypto.randomUUID()}`, p_provider_id: email.provider_id, p_request_id: email.request_id, p_link_id: email.payment_link_id, p_kind: email.kind, p_recipients: email.recipients, p_status: status, p_occurred_at: new Date().toISOString() });
  if (outcome.code !== 'recorded') throw problem();
  return json({ id: body.payment_link_id, code: 'checked', email_status: outcome.state });
}

async function checkPayment(context) {
  const { payment_link_id: id } = await staffAction(context, ['payment_link_id']);
  const record = await staffRecord(context.env, id);
  if (record.status === 'paid') return json({ id, code: 'paid', payment_status: 'paid' });
  const attempts = await db(context.env, `payment_attempts?${new URLSearchParams({ payment_link_id: `eq.${id}`, state: 'in.(processing,unknown,review)', select: 'id,order_id,amount,state,created_at,retref', limit: '1' })}`);
  const attempt = attempts?.[0];
  if (!attempt) return json({ id, code: 'no_active_attempt', payment_status: record.cancelled_at ? 'cancelled' : Date.parse(record.expires_at) <= Date.now() ? 'expired' : 'unpaid' });
  if (attempt.state === 'processing' && Date.now() - Date.parse(attempt.created_at) < 60000) return json({ id, code: 'still_processing', payment_status: 'processing' });
  const paid = await reconcile(context, record, attempt);
  return json({ id, code: paid ? 'paid' : 'merchant_review', payment_status: paid ? 'paid' : attempt.state === 'review' ? 'review' : 'processing' });
}

async function cancelLink(context) {
  const { payment_link_id: id } = await staffAction(context, ['payment_link_id']);
  const result = await rpc(context.env, 'portal_cancel_link', { p_link_id: id });
  if (result.code !== 'cancelled' || result.id !== id) throw problem('action_unavailable', 409);
  return json({ id, cancelled: true });
}

async function replaceLink(context) {
  const body = await staffAction(context, ['payment_link_id', 'request_id']);
  const result = await rpc(context.env, 'portal_replace_link', { p_link_id: body.payment_link_id, p_request_id: body.request_id, p_hash: await digest(`replace:${body.payment_link_id}`) });
  if (!['replaced', 'existing'].includes(result.code) || !UUID.test(result.id || '')) throw problem('action_unavailable', 409);
  return json({ id: result.id, replaced_id: body.payment_link_id });
}

async function exportLinks(context) {
  await authenticated(context.request, context.env);
  const query = dashboardQuery(new URL(context.request.url).searchParams);
  if (!query || query.view !== 'links') throw problem('invalid_request', 400);
  await limit(context.request, context.env, 'export', 5);
  const result = await rpc(context.env, 'portal_staff_export', { p_search: query.search, p_payment: query.payment, p_email: query.email, p_start: query.start || null, p_end: query.end || null, p_customer: query.customer });
  if (result.code === 'too_many') throw problem('export_too_large', 413);
  if (!Array.isArray(result.links) || result.links.length > 10000 || !result.links.every(validStaffLink)) throw problem();
  return new Response(invoiceCsv(result.links), { headers: { ...securityHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="payment-history.csv"' } });
}

async function staffLink(context) {
  await authenticated(context.request, context.env);
  const id = new URL(context.request.url).searchParams.get('id');
  if (!UUID.test(id || '')) throw problem('invalid_request', 400);
  await limit(context.request, context.env, 'staff-detail', 60);
  const result = await rpc(context.env, 'portal_staff_link', { p_id: id });
  if (!result) throw problem('unavailable', 404);
  if (!validStaffDetail(result)) throw problem();
  return json(result);
}

async function staffLinks(context) {
  await authenticated(context.request, context.env);
  const query = dashboardQuery(new URL(context.request.url).searchParams);
  if (!query) throw problem('invalid_request', 400);
  await limit(context.request, context.env, 'dashboard', 60);
  const result = await rpc(context.env, 'portal_staff_dashboard', { p_search: query.search, p_payment: query.payment, p_email: query.email, p_offset: query.offset, p_limit: query.limit, p_start: query.start || null, p_end: query.end || null, p_customer: query.customer, p_view: query.view });
  if (!validDashboard(result)) throw problem();
  return json(result);
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
    if (path === '/resend-webhook' && request.method === 'POST') return await webhook(context);
    if (path === '/send-receipt-email' && request.method === 'POST') return await sendLinkEmail(context, 'customer_receipt');
    if (path === '/check-email-status' && request.method === 'POST') return await checkEmail(context);
    if (path === '/check-payment' && request.method === 'POST') return await checkPayment(context);
    if (path === '/cancel-link' && request.method === 'POST') return await cancelLink(context);
    if (path === '/replace-link' && request.method === 'POST') return await replaceLink(context);
    if (path === '/staff-export' && request.method === 'GET') return await exportLinks(context);
    if (path === '/staff-link' && request.method === 'GET') return await staffLink(context);
    if (path === '/send-link-email' && request.method === 'POST') return await sendLinkEmail(context);
    if (path === '/staff-links' && request.method === 'GET') return await staffLinks(context);
    if (path === '/payment-link' && request.method === 'GET') return await lookup(context);
    if (path === '/charge' && request.method === 'POST') return await charge(context);
    if (path === '/create-link' && request.method === 'GET') {
      await authenticated(request, context.env);
      const requestId = url.searchParams.get('request_id');
      if (!UUID.test(requestId || '')) throw problem('invalid_request', 400);
      await limit(request, context.env, 'recover', 20);
      const records = await db(context.env, `payment_links?${new URLSearchParams({ request_id: `eq.${requestId}`, select: 'id,link_email_sent,link_email_status', limit: '1' })}`);
      if (!records?.[0]) return fail('not_found', 404, 'No link was found for this request.');
      return json({ id: records[0].id, email_sent: records[0].link_email_sent === true, email_status: records[0].link_email_sent ? 'accepted' : records[0].link_email_status || 'unknown' });
    }
    if (path === '/create-link' && request.method === 'POST') return await createLink(context);
    if (path === '/analyze-invoice' && request.method === 'POST') return await invoice(context);
    return fail('not_found', 404, 'This endpoint is unavailable.');
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 503;
    const code = ['configuration_unavailable', 'staff_rate_limit_unavailable', 'mock_payments_disabled', 'request_timeout', 'invalid_request', 'request_too_large', 'invalid_origin', 'rate_limited', 'unauthorized', 'invalid_link', 'unavailable', 'invalid_payment', 'amount_changed', 'invalid_attachments', 'invalid_link_details', 'creation_conflict', 'email_unavailable', 'invalid_webhook', 'action_unavailable', 'export_too_large'].includes(error.message) ? error.message : 'service_unavailable';
    const configurationFields = new URL(request.url).pathname === '/staff-session' && code === 'configuration_unavailable' && Array.isArray(error.configurationFields) ? error.configurationFields.filter((name) => ['APP_ENV', 'SESSION_SECRET', 'STAFF_PASSCODE', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].includes(name)) : [];
    return fail(code, status, code === 'export_too_large' ? 'Export is limited to 10,000 links. Narrow the filters and try again.' : status === 401 ? 'Your staff session is invalid or expired. Sign in again.' : status === 429 ? 'Too many requests. Wait a few minutes before trying again.' : status >= 500 ? 'This service is temporarily unavailable. Please try again later.' : 'Please review the request or contact the merchant for help.', configurationFields);
  }
}
