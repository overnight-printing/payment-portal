import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../server/api.js';
import worker from '../worker/src/index.js';
import { parseInvoiceText } from '../server/invoice.js';
import { moneyCents, gatewayCents, invoiceFields, batchIssue, validCardholderName } from '../shared/validation.js';

const id = '00000000-0000-4000-8000-000000000001';
const env = { APP_ENV: 'test', PUBLIC_ORIGIN: 'https://portal.invalid', SUPABASE_URL: 'https://database.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only', CARDPOINTE_USER: 'synthetic-only', CARDPOINTE_PASS: 'synthetic-only', CARDPOINTE_MID: 'synthetic-only', STAFF_PASSCODE: 'synthetic-passcode-only', SESSION_SECRET: 'synthetic-session-secret-for-local-tests-only', RESEND_API_KEY: 'synthetic-only' };
const validPayment = { paymentLinkId: id, amount: '10.00', cardholderName: 'Jamie Cardholder', token: '9'.padEnd(16, '0'), expiry: '1299', cvv2: '000', zip: '00000' };
const invoice = () => ({ id, order_number: 'AUDIT-001', amount: '10.00', customer_name: 'Audit Buyer', customer_email: 'audit@example.invalid', status: 'pending', retref: null, paid_at: null, expires_at: '2099-01-01T00:00:00Z', receipt_sent: false, link_email_sent: false });
const req = (path, body, cookie) => new Request(`https://portal.invalid${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: env.PUBLIC_ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const context = (request, overrides = {}) => ({ request, env: { ...env, ...overrides }, waitUntil: () => {} });

function fixture(options = {}) {
  const originalFetch = globalThis.fetch;
  let record = invoice();
  let attempt;
  let creation;
  let hashes;
  const requests = [];
  const counts = { auth: 0, capture: 0, create: 0, email: 0 };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ host: url.hostname, path: url.pathname, body });
    if (url.hostname === 'database.invalid') {
      if (url.pathname.endsWith('/portal_rate_limit')) return Response.json(options.limited ? false : true);
      if (url.pathname.endsWith('/portal_claim_payment')) {
        if (record.status === 'paid') return Response.json({ code: 'paid', retref: record.retref, paid_at: record.paid_at });
        if (attempt && ['processing', 'unknown', 'review'].includes(attempt.state)) return Response.json({ code: 'pending', attempt });
        attempt = { id: body.p_attempt_id, order_id: body.p_order_id, amount: record.amount, state: 'processing', created_at: new Date().toISOString() };
        return Response.json({ code: 'claimed', attempt });
      }
      if (url.pathname.endsWith('/portal_finish_payment')) {
        if (body.p_state === 'paid' && options.failFinalize) return Response.json({}, { status: 500 });
        if (attempt.state === 'paid') return Response.json({ state: 'paid', retref: attempt.retref });
        attempt.state = body.p_state;
        if (body.p_retref) attempt.retref = body.p_retref;
        if (body.p_last4) attempt.card_last4 = body.p_last4;
        if (body.p_state === 'paid') record = { ...record, status: 'paid', retref: body.p_retref, paid_at: new Date().toISOString(), card_last4: attempt.card_last4 || null };
        return Response.json({ state: attempt.state, retref: attempt.retref });
      }
      if (url.pathname.endsWith('/portal_create_link')) {
        if (creation && hashes !== body.p_hash) return Response.json({ code: 'conflict' });
        if (!creation) { counts.create++; hashes = body.p_hash; creation = { ...record, request_id: body.p_request_id, customer_name: body.p_customer_name, customer_email: body.p_customer_email, order_number: body.p_order_number, amount: body.p_amount }; }
        return Response.json({ code: 'created', link: creation });
      }
      if (url.pathname.endsWith('/payment_attempts')) return Response.json(attempt && ['processing', 'unknown', 'review'].includes(attempt.state) ? [attempt] : []);
      if (url.pathname.endsWith('/payment_links')) {
        if (init.method === 'PATCH') { record = { ...record, ...body }; return Response.json([record]); }
        return Response.json([options.record ? { ...record, ...options.record } : record]);
      }
    }
    if (url.hostname === 'fts-uat.cardconnect.com') {
      if (url.pathname.endsWith('/auth')) {
        counts.auth++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (options.gatewayFailure) throw new Error('synthetic provider failure');
        return Response.json(options.authorization || { respstat: 'A', retref: '123456789012', amount: '1000' });
      }
      if (url.pathname.endsWith('/capture')) { counts.capture++; return Response.json(options.capture || { respstat: 'A', retref: '123456789012', amount: '10.00', setlstat: 'Queued for Capture' }); }
      if (url.pathname.includes('/inquireByOrderid/')) return Response.json(options.inquiry || { respstat: 'B' });
    }
    if (url.hostname === 'api.resend.com') { counts.email++; return Response.json(options.emailFailure ? {} : { id: 'synthetic-email' }, { status: options.emailFailure ? 500 : 200 }); }
    throw new Error('Unexpected external request blocked by test');
  };
  return { counts, requests, record: () => record, attempt: () => attempt, restore: () => { globalThis.fetch = originalFetch; } };
}

async function login() {
  const response = await handleApi(context(req('/staff-session', { passcode: env.STAFF_PASSCODE })));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).authenticated, true);
  const cookie = response.headers.get('Set-Cookie');
  assert(cookie.includes('HttpOnly') && cookie.includes('Secure') && cookie.includes('SameSite=Strict'));
  assert(!cookie.includes(env.STAFF_PASSCODE));
  return cookie.split(';')[0];
}

// All credentials/payment inputs in this file are synthetic; fetch is blocked outside the fixture.
test('payment trust boundaries and durable recovery', async (t) => {
  await t.test('exact money, model signs/types and gateway minor units', () => {
    for (const value of [null, '', 'NaN', '1e2', '-25.00', 0, '10.001', '10abc', {}, Infinity]) assert.equal(moneyCents(value), null);
    assert.equal(moneyCents('10.00'), 1000); assert.equal(gatewayCents('1000'), 1000); assert.equal(gatewayCents('10.00'), 1000);
    const fields = invoiceFields({ order_number: '123', amount: '-25.00', customer_name: {}, customer_email: 'invalid' });
    assert.equal(fields.amount, ''); assert.equal(fields.customer_name, ''); assert.equal(fields.customer_email, '');
    assert.equal(parseInvoiceText('No: 123\nAMOUNT DUE -$25.00\nTOTAL $100.00').amount, '');
    assert.equal(parseInvoiceText('No: 123\nAMOUNT DUE $0.00\nTOTAL $100.00').amount, '');
    assert.equal(parseInvoiceText('No: 123\nAMOUNT DUE $1,234.56').amount, '1234.56');
    assert.equal(parseInvoiceText('No: 123\nAMOUNT DUE $1,23').amount, '');
    assert.equal(parseInvoiceText('No: 123\nAMOUNT DUE $1.2.3').amount, '');
    assert(validCardholderName('Jamie Cardholder')); assert(!validCardholderName(' ')); assert(!validCardholderName('x'.repeat(31)));
  });

  await t.test('concurrent clients charge once and pass the separate cardholder name', async () => {
    const f = fixture();
    try {
      const results = await Promise.all([handleApi(context(req('/charge', validPayment))), handleApi(context(req('/charge', validPayment)))]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 202]);
      assert.equal(f.counts.auth, 1); assert.equal(f.counts.capture, 1); assert.equal(f.record().status, 'paid');
      const auth = f.requests.find((r) => r.path.endsWith('/auth')).body;
      assert.equal(auth.amount, '10.00'); assert.equal(auth.name, 'Jamie Cardholder'); assert.notEqual(auth.name, f.record().customer_name); assert.equal(auth.capture, 'N');
      assert(f.requests.filter((r) => r.host === 'database.invalid').every((r) => !r.body || !('token' in r.body || 'cvv2' in r.body || 'cardholderName' in r.body || 'account' in r.body)));
      const replay = await handleApi(context(req('/charge', validPayment))); assert.equal(replay.status, 200); assert.equal(f.counts.auth, 1);
    } finally { f.restore(); }
  });

  for (const [name, options] of [['post-capture database failure', { failFinalize: true }], ['unknown gateway outcome', { gatewayFailure: true }], ['partial approval', { authorization: { respstat: 'A', retref: '123456789012', amount: '500' } }], ['uncaptured authorization', { capture: { respstat: 'A', retref: '123456789012', amount: '1000', setlstat: 'Authorized' } }]]) {
    await t.test(`${name} remains locked across retries`, async () => {
      const f = fixture(options);
      try {
        const first = await handleApi(context(req('/charge', validPayment))); assert.equal(first.status, 202);
        const second = await handleApi(context(req('/charge', validPayment))); assert.equal(second.status, 202);
        assert.equal(f.counts.auth, 1); assert.notEqual(f.record().status, 'paid');
        if (name === 'partial approval') assert.equal(f.counts.capture, 0);
      } finally { f.restore(); }
    });
  }

  await t.test('a later conclusive inquiry resolves capture and sends a receipt without recharging', async () => {
    const options = { failFinalize: true };
    const f = fixture(options);
    try {
      assert.equal((await handleApi(context(req('/charge', validPayment)))).status, 202);
      f.attempt().created_at = '2000-01-01T00:00:00Z';
      options.failFinalize = false;
      options.inquiry = { respstat: 'A', retref: '123456789012', amount: '1000', setlstat: 'Queued for Capture' };
      const response = await handleApi(context(req(`/payment-link?id=${id}`)));
      const result = await response.json();
      assert.equal(result.status, 'paid'); assert.equal(result.receipt_sent, true);
      assert.equal(f.counts.auth, 1); assert.equal(f.counts.capture, 1);
    } finally { f.restore(); }
  });

  await t.test('a definite declined authorization is recoverable', async () => {
    const f = fixture({ authorization: { respstat: 'C', resptext: 'synthetic raw detail' } });
    try {
      const response = await handleApi(context(req('/charge', validPayment))); assert.equal(response.status, 402);
      assert(!(await response.text()).includes('synthetic raw detail')); assert.equal(f.attempt().state, 'declined'); assert.equal(f.counts.capture, 0);
    } finally { f.restore(); }
  });

  await t.test('invalid name, raw PAN shape, amount and lifecycle never reach gateway', async () => {
    const f = fixture();
    try {
      for (const overrides of [{ amount: undefined }, { cardholderName: '' }, { cardholderName: 'x'.repeat(31) }, { token: '4'.padEnd(16, '0') }, { amount: '9.99' }, { amount: 'not-money' }, { paymentLinkId: `${id}&select=*` }]) {
        const response = await handleApi(context(req('/charge', { ...validPayment, ...overrides }))); assert.equal(response.status, 400);
      }
      assert.equal(f.counts.auth, 0);
    } finally { f.restore(); }
    for (const record of [{ status: 'cancelled' }, { cancelled_at: new Date().toISOString() }, { expires_at: '2000-01-01T00:00:00Z' }, { amount: null }]) {
      const local = fixture({ record });
      try { assert.equal((await handleApi(context(req('/charge', validPayment)))).status, 404); assert.equal(local.counts.auth, 0); } finally { local.restore(); }
    }
  });

  await t.test('public lookup is allowlisted, noncacheable and Worker uses the same contract', async () => {
    const f = fixture({ record: { internal_note: 'must-not-escape' } });
    try {
      const response = await worker.fetch(req(`/payment-link?id=${id}`), env, { waitUntil() {} });
      const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.currency, 'USD'); assert(!('internal_note' in body));
      assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
      assert.equal((await handleApi(context(req('/payment-link?id=bad')))).status, 400);
    } finally { f.restore(); }
  });

  await t.test('staff session fails closed, expires, rejects cross-origin and limits attempts', async () => {
    const f = fixture();
    try {
      assert.equal((await handleApi(context(req('/staff-session', { passcode: 'wrong' })))).status, 401);
      assert.equal((await handleApi(context(req('/staff-session', { passcode: 'anything' }), { STAFF_PASSCODE: '' }))).status, 503);
      assert.equal((await handleApi(context(req('/staff-session', { passcode: env.STAFF_PASSCODE }), { SESSION_SECRET: '' }))).status, 503);
      const cookie = await login(); assert.equal((await handleApi(context(req('/staff-session', undefined, cookie)))).status, 200);
      assert.equal((await handleApi(context(req('/staff-session', undefined, '__Host-portal_session=1.' + 'a'.repeat(64))))).status, 401);
      const cross = new Request('https://portal.invalid/staff-session', { method: 'POST', headers: { Origin: 'https://other.invalid', 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal((await handleApi(context(cross))).status, 403);
    } finally { f.restore(); }
    const limited = fixture({ limited: true });
    try { assert.equal((await handleApi(context(req('/staff-session', { passcode: env.STAFF_PASSCODE })))).status, 429); } finally { limited.restore(); }
  });

  await t.test('creation retry returns the same link and retains email failure', async () => {
    const f = fixture({ emailFailure: true });
    try {
      const cookie = await login();
      const body = { request_id: crypto.randomUUID(), order_number: 'AUDIT-001', amount: '10.00', customer_name: '<b>Literal name</b>', company_name: '', customer_email: 'audit@example.invalid', attachments: [], send_email: true };
      for (let i = 0; i < 2; i++) {
        const response = await handleApi(context(req('/create-link', body, cookie))); const result = await response.json();
        assert.equal(response.status, 200); assert.equal(result.id, id); assert.equal(result.email_status, 'failed');
      }
      assert.equal(f.counts.create, 1);
      const email = f.requests.find((r) => r.host === 'api.resend.com').body;
      assert(email.html.includes('&lt;b&gt;Literal name&lt;/b&gt;')); assert(!email.html.includes('<b>Literal name</b>')); assert(email.text.includes('<b>Literal name</b>'));
      assert.equal((await handleApi(context(req('/create-link', { ...body, amount: '-1.00' }, cookie)))).status, 400);
      assert.equal((await handleApi(context(req('/create-link', { ...body, amount: '20.00' }, cookie)))).status, 409);
      assert.equal((await handleApi(context(req('/create-link', { ...body, request_id: crypto.randomUUID() })))).status, 401);
    } finally { f.restore(); }
  });

  await t.test('batch gates cover scanning, duplicates, mixed recipients and manual review', () => {
    const row = { status: 'success', reviewed: false, orderNumber: '123', amount: '10.00', customerName: 'Buyer', companyName: '', customerEmail: 'buyer@example.invalid' };
    assert.equal(batchIssue([row]), '');
    assert(batchIssue([{ ...row, status: 'scanning' }]));
    assert(batchIssue([row, { ...row }]));
    assert(batchIssue([row, { ...row, orderNumber: '456', customerEmail: 'other@example.invalid' }]));
    assert(batchIssue([{ ...row, status: 'review', reviewed: false }]));
    assert.equal(batchIssue([{ ...row, status: 'review', reviewed: true }]), '');
  });

  await t.test('malformed bodies and missing setup never leak exceptions', async () => {
    const f = fixture();
    try {
      const malformed = new Request('https://portal.invalid/charge', { method: 'POST', headers: { Origin: env.PUBLIC_ORIGIN, 'Content-Type': 'application/json' }, body: '{' });
      assert.equal((await handleApi(context(malformed))).status, 400);
      assert.equal((await handleApi(context(req('/charge', validPayment), { MOCK_PAYMENT: 'true' }))).status, 503);
      assert.equal(f.counts.auth, 0);
    } finally { f.restore(); }
  });
});
