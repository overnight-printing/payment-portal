import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentPath, decodePaymentCode } from '../shared/payment-link.js';
import { handleApi as rawHandleApi } from '../server/api.js';
import { invoiceCsv } from '../server/csv.js';
import { verifyWebhook } from '../server/email-events.js';
import { staffReceiptBody, customerReceiptBody } from '../server/staff-receipt.js';
import worker from '../worker/src/index.js';
import { parseInvoiceText } from '../server/invoice.js';
import { moneyCents, gatewayCents, invoiceFields, batchIssue, validCardholderName, validPaymentLink, dashboardQuery, validDashboard, UUID } from '../shared/validation.js';

const id = '00000000-0000-4000-8000-000000000001';

test('compact payment paths preserve every UUID bit and reject noncanonical codes', () => {
  const ids = [id, 'ffffffff-ffff-ffff-ffff-ffffffffffff', ...Array.from({ length: 100 }, () => crypto.randomUUID())];
  const paths = ids.map(value => paymentPath(value));
  assert.equal(new Set(paths).size, ids.length);
  for (const [index, path] of paths.entries()) {
    assert.match(path, /^\/p\/[A-Za-z0-9_-]{22}$/);
    assert.equal(decodePaymentCode(path.slice(3)), ids[index]);
    assert.equal(paymentPath(ids[index].toUpperCase()), path);
  }
  for (const code of [null, '', id, 'A'.repeat(21), 'A'.repeat(23), 'A'.repeat(21) + 'B', 'A'.repeat(21) + '=', 'A'.repeat(21) + '/', '<script>']) assert.equal(decodePaymentCode(code), null);
  assert.throws(() => paymentPath('invalid'));
});
const env = { APP_ENV: 'test', PUBLIC_ORIGIN: 'https://portal.invalid', SUPABASE_URL: 'https://database.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only', CARDPOINTE_USER: 'synthetic-only', CARDPOINTE_PASS: 'synthetic-only', CARDPOINTE_MID: 'synthetic-only', STAFF_PASSCODE: 'synthetic-passcode-only', SESSION_SECRET: 'synthetic-session-secret-for-local-tests-only', RESEND_API_KEY: 'synthetic-only' };
const validPayment = { paymentLinkId: id, amount: '10.00', cardholderName: 'Jamie Cardholder', token: '9'.padEnd(16, '0'), expiry: '1299', cvv2: '000', zip: '00000' };
const invoice = () => ({ id, order_number: 'AUDIT-001', amount: '10.00', customer_name: 'Audit Buyer', customer_email: 'audit@example.invalid', status: 'pending', retref: null, paid_at: null, expires_at: '2099-01-01T00:00:00Z', receipt_sent: false, link_email_sent: false });
const req = (path, body, cookie) => new Request(`https://portal.invalid${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: env.PUBLIC_ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const background = new Set();
const context = (request, overrides = {}) => ({ request, env: { ...env, ...overrides }, waitUntil: (promise) => { background.add(promise); promise.finally(() => background.delete(promise)); } });
async function handleApi(ctx) { const response = await rawHandleApi(ctx); await Promise.all([...background]); return response; }
const dashboard = () => ({ summary: { total: 1, paid: 0, unpaid: 1, paid_cents: 0, unpaid_cents: 1000 }, total: 1, offset: 0, limit: 25, links: [{ id, order_number: 'AUDIT-001', customer_name: null, customer_email: null, amount: '10.00', created_at: null, paid_at: null, payment_status: 'unpaid', email_status: 'unknown' }] });

function fixture(options = {}) {
  const originalFetch = globalThis.fetch;
  let record = invoice();
  let attempt = options.attempt;
  let creation;
  let hashes;
  const emails = new Map();
  const requests = [];
  const counts = { auth: 0, capture: 0, create: 0, email: 0, inquiry: 0, emailCheck: 0 };
  const events = new Set();
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ host: url.hostname, path: url.pathname, query: url.searchParams.toString(), body });
    if (url.hostname === 'database.invalid') {
      if (url.pathname.endsWith('/portal_rate_limit')) return options.rateFailure ? Response.json({}, { status: 500 }) : Response.json(options.limited ? false : true);
      if (url.pathname.endsWith('/portal_staff_dashboard')) return Response.json(options.badDashboard ? { links: 'invalid' } : dashboard());
      if (url.pathname.endsWith('/portal_staff_link')) return Response.json({ link: { ...dashboard().links[0], customer_name: record.customer_name, customer_email: record.customer_email, expires_at: record.expires_at, email_status: record.link_email_status || 'unknown' }, emails: [...emails.values()].map(({ request_id, state, created_at, finished_at }) => ({ request_id, state, created_at, finished_at })) });
      if (url.pathname.endsWith('/portal_claim_email') || url.pathname.endsWith('/portal_claim_link_email_to')) {
        const contacts = url.pathname.endsWith('/portal_claim_link_email_to');
        const kind = contacts ? 'payment_link' : body.p_kind;
        const existing = emails.get(body.p_request_id);
        if (existing) return Response.json(existing.payment_link_id === body.p_link_id && existing.kind === kind && (!contacts || existing.recipients[0] === body.p_customer_email) ? { code: 'existing', state: existing.state } : { code: 'conflict' });
        const current = { ...record, ...options.record };
        if (kind === 'payment_link' ? current.status !== 'pending' || Date.parse(current.expires_at) <= Date.now() || current.cancelled_at || attempt && ['processing', 'unknown', 'review'].includes(attempt.state) : current.status !== 'paid') return Response.json({ code: 'unavailable' });
        if ([...emails.values()].some((email) => email.state === 'pending' && email.kind === kind)) return Response.json({ code: 'pending', state: 'pending' });
        if (contacts) { record = { ...record, customer_name: body.p_customer_name, customer_email: body.p_customer_email }; if (creation) creation = record; current.customer_email = record.customer_email; }
        emails.set(body.p_request_id, { request_id: body.p_request_id, payment_link_id: body.p_link_id, kind: kind, recipients: kind === 'staff_receipt' ? ['accounting@overnightprintingseattle.com','contact@overnightprintingseattle.com'] : [current.customer_email], state: 'pending', created_at: new Date().toISOString(), finished_at: null });
        if (kind === 'payment_link') { record.link_email_status = 'pending'; if (creation) creation.link_email_status = 'pending'; }
        return Response.json({ code: 'claimed', state: 'pending' });
      }
      if (url.pathname.endsWith('/portal_finish_email')) {
        if (options.failEmailTracking) return Response.json({}, { status: 500 });
        const email = emails.get(body.p_request_id);
        if (email.state === 'pending') { email.state = body.p_state; email.finished_at = body.p_state === 'pending' ? null : new Date().toISOString(); }
        email.provider_id ||= body.p_provider_id;
        if (email.kind === 'payment_link') { record.link_email_status = email.state; record.link_email_sent ||= email.state === 'accepted'; if (creation) creation = { ...creation, link_email_status: email.state, link_email_sent: record.link_email_sent }; }
        if (email.kind === 'customer_receipt' && email.state === 'accepted') record.receipt_sent = true;
        return Response.json({ state: email.state });
      }
      if (url.pathname.endsWith('/portal_record_email_event')) {
        if (options.eventFailure) return Response.json({}, { status: 500 });
        const email = emails.get(body.p_request_id) || [...emails.values()].find((e) => e.provider_id === body.p_provider_id);
        if (!email || email.payment_link_id !== body.p_link_id || email.kind !== body.p_kind || email.provider_id && email.provider_id !== body.p_provider_id || !body.p_recipients.every((to) => email.recipients.includes(to))) return Response.json({ code: 'ignored' });
        if (!events.has(body.p_event_id)) { events.add(body.p_event_id); email.delivery_status = body.p_status; email.state = 'accepted'; email.provider_id = body.p_provider_id; }
        return Response.json({ code: 'recorded', state: email.delivery_status });
      }
      if (url.pathname.endsWith('/portal_link_emails')) {
        const email = emails.get(url.searchParams.get('request_id')?.slice(3));
        return Response.json(email && email.payment_link_id === url.searchParams.get('payment_link_id')?.slice(3) ? [email] : []);
      }
      if (url.pathname.endsWith('/portal_cancel_link')) {
        if ((options.record?.status || record.status) === 'paid' || attempt && ['processing','unknown','review'].includes(attempt.state)) return Response.json({ code: 'unavailable' });
        record.cancelled_at ||= new Date().toISOString(); return Response.json({ code: 'cancelled', id: record.id });
      }
      if (url.pathname.endsWith('/portal_replace_link')) return Response.json(options.actionBlocked ? {code:'unavailable'} : { code: 'replaced', id: '80000000-0000-4000-8000-000000000001' });
      if (url.pathname.endsWith('/portal_staff_export')) return Response.json(options.exportTooLarge ? { code: 'too_many' } : { links: Array.from({length:60}, (_,i)=>({...dashboard().links[0], order_number:`CSV-${i}`, customer_name:'=HYPERLINK("bad")'})) });
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
        if (creation) creation = record;
        return Response.json({ state: attempt.state, retref: attempt.retref });
      }
      if (url.pathname.endsWith('/portal_create_link')) {
        if (creation && hashes !== body.p_hash) return Response.json({ code: 'conflict' });
        if (!creation) { counts.create++; hashes = body.p_hash; creation = { ...record, request_id: body.p_request_id, customer_name: body.p_customer_name, customer_email: body.p_customer_email, order_number: body.p_order_number, amount: body.p_amount }; record = creation; }
        return Response.json({ code: 'created', link: creation });
      }
      if (url.pathname.endsWith('/payment_attempts')) return Response.json(attempt && ['processing', 'unknown', 'review'].includes(attempt.state) ? [attempt] : []);
      if (url.pathname.endsWith('/payment_links')) {
        if (init.method === 'PATCH') {
          if (options.failEmailTracking && body.link_email_status === 'accepted') return Response.json({}, { status: 500 });
          if (url.searchParams.get('link_email_sent') === 'eq.false' && (creation || record).link_email_sent) return Response.json([]);
          record = { ...record, ...body }; if (creation) creation = { ...creation, ...body }; return Response.json([record]);
        }
        return Response.json([options.record ? { ...record, ...options.record } : creation || record]);
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
      if (url.pathname.includes('/inquireByOrderid/')) { counts.inquiry++; return Response.json(options.inquiry || { respstat: 'B' }); }
    }
    if (url.hostname === 'api.resend.com') {
      if (!init.method || init.method === 'GET') { counts.emailCheck++; const email = [...emails.values()].find((e)=>e.provider_id === url.pathname.split('/').at(-1)); return Response.json({ id: email?.provider_id, to: email?.recipients, last_event: 'delivered', tags: [{name:'portal_app',value:'payment_portal'},{name:'portal_request',value:email?.request_id},{name:'portal_link',value:email?.payment_link_id},{name:'portal_kind',value:email?.kind}], ...options.emailRetrieval }); }
      counts.email++;
      if (options.concurrentEmailAccepted) { record = { ...record, link_email_sent: true, link_email_status: 'accepted' }; creation = { ...creation, link_email_sent: true, link_email_status: 'accepted' }; const email = [...emails.values()].at(-1); if (email) email.state = 'accepted'; }
      if (options.emailNetworkFailure) throw new Error('Synthetic network failure');
      return Response.json(options.emailFailure ? {} : { id: crypto.randomUUID() }, { status: options.emailFailure ? 422 : 200 });
    }
    throw new Error('Unexpected external request blocked by test');
  };
  return { counts, requests, emails, events, record: () => record, attempt: () => attempt, restore: () => { globalThis.fetch = originalFetch; } };
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
    const partial = parseInvoiceText('No: 123\nShip To:\nBuyer One\nExample Company\nPhone: 206-555-0100\nQuantity Description Amount\nAMOUNT DUE $58.00');
    assert.equal(partial.amount, '58.00'); assert.equal(partial.order_number, '123'); assert.equal(partial.customer_email, '');
    assert.equal(parseInvoiceText('No: 123\nTOTAL $58.00').amount, '');
    assert.equal(parseInvoiceText('No: 123\nAMOUNT DUE -$5.00\nTOTAL $58.00').amount, '');
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
      assert.equal(f.requests.find((r) => r.body?.from?.startsWith('Billing Alerts')).body.subject, '[Paid] Audit Buyer - Invoice #AUDIT-001 - $10.00');
    } finally { f.restore(); }
  });

  await t.test('distinct branded confirmations expose escaped, copyable payment details', async () => {
    const f = fixture({ record: { order_number: 'AUDIT-001, AUDIT-002', amount: '2596.96', customer_name: 'Sample & Co. (Printing <Studio>)', customer_email: 'billing@example.invalid', paid_at: '2026-10-13T17:05:09Z', card_last4: '1234' }, authorization: { respstat: 'A', retref: '123456789012', amount: '259696' }, capture: { respstat: 'A', retref: '123456789012', amount: '2596.96', setlstat: 'Queued for Capture' } });
    try {
      assert.equal((await handleApi(context(req('/charge', { ...validPayment, amount: '2596.96' })))).status, 200);
      const staff = f.requests.find((r) => r.body?.from?.startsWith('Billing Alerts')).body;
      const customer = f.requests.find((r) => r.body?.to?.includes('billing@example.invalid')).body;
      assert.equal(staff.subject, '[Paid] Sample & Co. (Printing <Studio>) - Invoice #AUDIT-001, AUDIT-002 - $2,596.96');
      assert.deepEqual(staff.to, ['accounting@overnightprintingseattle.com', 'contact@overnightprintingseattle.com']);
      for (const value of ['Invoice Number(s): AUDIT-001, AUDIT-002', 'Amount Paid: $2,596.96', 'Customer / Company: Sample & Co. (Printing <Studio>)', 'Customer Email: billing@example.invalid', 'Payment Reference: 123456789012', 'Payment Method: Credit card ending in 1234']) assert(staff.text.includes(value));
      assert(staff.html.includes('<th')); assert(staff.html.includes('scope="row"')); assert(staff.html.includes('Sample &amp; Co. (Printing &lt;Studio&gt;)')); assert(!staff.html.includes('<Studio>'));
      assert(!staff.html.includes('Hello ')); assert(!staff.text.includes(validPayment.token));
      assert.equal(customer.subject, 'Payment received: Invoice #AUDIT-001, AUDIT-002');
      assert.deepEqual(customer.to, ['billing@example.invalid']);
      assert(customer.html.includes('Hello Sample &amp; Co.'));
      for (const mail of [staff, customer]) {
        assert(mail.html.includes('https://pay.overnightprintingseattle.com/logo.png'));
        assert(mail.html.includes('alt="Overnight Printing Seattle"'));
        assert(mail.html.includes('Arial,Helvetica,sans-serif'));
        assert(mail.html.includes('#1e2f66'));
        assert(!mail.html.includes('<Studio>')); assert(!mail.text.includes(validPayment.token));
        assert(!mail.text.includes('Paid At')); assert(!mail.html.includes('Paid At'));
      }
      for (const mail of [staff, customer]) {
        assert(!mail.html.includes('STAFF CONFIRMATION'));
        assert(!mail.html.includes('USD')); assert(!mail.text.includes('USD'));
        assert(mail.html.includes('https://pay.overnightprintingseattle.com/payment-success.png'));
        assert(mail.html.includes('text-align:center'));
      }
      assert(!staff.text.includes('Payment Date'));
      for (const value of ['Amount Paid: $2,596.96', 'Invoice Number(s): AUDIT-001, AUDIT-002', 'Payment Reference: 123456789012', 'Payment Method: Credit card ending in 1234', 'Payment Date: Oct 13, 2026']) assert(customer.text.includes(value));
      assert(!customer.text.includes('PDT')); assert(!customer.html.includes('Internal payment confirmation'));
    } finally { f.restore(); }
    for (const record of [{ card_last4: null, paid_at: null }, { card_last4: 'invalid', paid_at: 'invalid' }, { card_last4: null, paid_at: '2026-01-13T18:05:09Z' }]) {
      const f = fixture({ record });
      try {
        assert.equal((await handleApi(context(req('/charge', validPayment)))).status, 200);
        const staff = f.requests.find((r) => r.body?.from?.startsWith('Billing Alerts')).body;
        const customer = f.requests.find((r) => r.body?.to?.includes('audit@example.invalid')).body;
        assert(staff.text.includes('Payment Method: Credit card\n')); assert(!staff.text.includes('ending in'));
        assert(!staff.text.includes('Paid At')); assert(!staff.text.includes('Payment Date'));
        assert(customer.text.includes('Payment Method: Credit card\n')); assert(!customer.text.includes('ending in'));
        assert.equal(customer.text.includes('Payment Date:'), record.paid_at?.startsWith('2026') === true);
        if (record.paid_at?.startsWith('2026')) assert(customer.text.includes('Payment Date: Jan 13, 2026'));
        assert(!customer.html.includes('Invalid Date'));
      } finally { f.restore(); }
    }
  });

  await t.test('receipt amounts are grouped without changing cents and staff subjects identify the customer', () => {
    for (const [amount, formatted] of [['999.99', '999.99'], ['1000.00', '1,000.00'], ['2596.96', '2,596.96'], ['1000000.00', '1,000,000.00']]) {
      const record = { ...invoice(), amount, customer_name: '  Example   Company  ' };
      const staff = staffReceiptBody(record);
      assert.equal(staff.subject, `[Paid] Example Company - Invoice #AUDIT-001 - $${formatted}`);
      for (const mail of [staff, customerReceiptBody(record)]) {
        assert(mail.text.includes(`Amount Paid: $${formatted}\n`));
        assert(mail.html.includes(`$${formatted}`));
      }
    }
    for (const customer_name of [null, '', 'Example\r\nInjected header']) {
      assert.equal(staffReceiptBody({ ...invoice(), customer_name }).subject, '[Paid] Customer - Invoice #AUDIT-001 - $10.00');
    }
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
      assert.equal((await handleApi(context(req('/staff-session', { passcode: '012345678' }), { STAFF_PASSCODE: '012345678' }))).status, 503);
      assert.equal((await handleApi(context(req('/staff-session', { passcode: '0123456789' }), { STAFF_PASSCODE: '0123456789' }))).status, 200);
      const cookie = await login(); assert.equal((await handleApi(context(req('/staff-session', undefined, cookie)))).status, 200);
      assert.equal((await handleApi(context(req('/staff-session', undefined, '__Host-portal_session=1.' + 'a'.repeat(64))))).status, 401);
      const cross = new Request('https://portal.invalid/staff-session', { method: 'POST', headers: { Origin: 'https://other.invalid', 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal((await handleApi(context(cross))).status, 403);
    } finally { f.restore(); }
    const limited = fixture({ limited: true });
    try { assert.equal((await handleApi(context(req('/staff-session', { passcode: env.STAFF_PASSCODE })))).status, 429); } finally { limited.restore(); }
  });

  await t.test('staff session lasts exactly 24 hours with expiry, tampering, rotation and logout enforced', async (t) => {
    const f = fixture();
    const signedInAt = Date.parse('2026-10-14T12:00:00Z');
    let now = signedInAt;
    t.mock.method(Date, 'now', () => now);
    try {
      const response = await handleApi(context(req('/staff-session', { passcode: env.STAFF_PASSCODE })));
      assert.equal(response.status, 200);
      const header = response.headers.get('Set-Cookie');
      assert.match(header, /; Path=\/; HttpOnly; SameSite=Strict; Max-Age=86400; Secure$/);
      const cookie = header.split(';')[0];
      const expiry = Number(cookie.split('=')[1].split('.')[0]);
      assert.equal(expiry, signedInAt / 1000 + 86400);
      for (const elapsed of [0, 3601, 86399]) {
        now = signedInAt + elapsed * 1000;
        assert.equal((await handleApi(context(req('/staff-session', undefined, cookie)))).status, 200);
        assert.equal((await worker.fetch(req('/staff-session', undefined, cookie), env, { waitUntil() {} })).status, 200);
      }
      const tampered = cookie.replace(String(expiry), String(expiry - 1));
      assert.equal((await handleApi(context(req('/staff-session', undefined, tampered)))).status, 401);
      assert.equal((await handleApi(context(req('/staff-session', undefined, cookie), { STAFF_PASSCODE: 'rotated-synthetic-passcode' }))).status, 401);
      const logout = await handleApi(context(new Request('https://portal.invalid/staff-session', { method: 'DELETE', headers: { Origin: env.PUBLIC_ORIGIN, Cookie: cookie } })));
      assert.equal(logout.status, 200);
      assert.match(logout.headers.get('Set-Cookie'), /^__Host-portal_session=;.*Max-Age=0; Secure$/);
      for (const elapsed of [86400, 86401]) {
        now = signedInAt + elapsed * 1000;
        assert.equal((await handleApi(context(req('/staff-session', undefined, cookie)))).status, 401);
        assert.equal((await worker.fetch(req('/staff-session', undefined, cookie), env, { waitUntil() {} })).status, 401);
      }
    } finally { f.restore(); }
  });

  await t.test('staff setup failures identify names without values and rate-store failure stays closed', async () => {
    const missing = await handleApi(context(req('/staff-session'), { APP_ENV: 'Production', SESSION_SECRET: '', STAFF_PASSCODE: '' }));
    assert.equal(missing.status, 503);
    assert.deepEqual((await missing.json()).configuration_fields, ['APP_ENV', 'SESSION_SECRET', 'STAFF_PASSCODE']);
    const short = await handleApi(context(req('/staff-session'), { SESSION_SECRET: 'synthetic-short' }));
    const shortBody = await short.json();
    assert.deepEqual(shortBody.configuration_fields, ['SESSION_SECRET']);
    assert(!JSON.stringify(shortBody).includes('synthetic-short'));
    const f = fixture({ rateFailure: true });
    try {
      const response = await handleApi(context(req('/staff-session', { passcode: env.STAFF_PASSCODE })));
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, 'staff_rate_limit_unavailable');
      assert.equal(response.headers.get('Set-Cookie'), null);
    } finally { f.restore(); }
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
      assert.equal(f.record().link_email_status, 'failed');
      const recovered = await (await handleApi(context(req(`/create-link?request_id=${body.request_id}`, undefined, cookie)))).json();
      assert.equal(recovered.email_status, 'failed');
      const email = f.requests.find((r) => r.host === 'api.resend.com').body;
      assert(email.text.includes(`${env.PUBLIC_ORIGIN}${paymentPath(id)}`));
      assert(email.html.includes(`${env.PUBLIC_ORIGIN}${paymentPath(id)}`));
      assert(!email.text.includes('/pay/'));
      assert(email.html.includes('&lt;b&gt;Literal name&lt;/b&gt;')); assert(!email.html.includes('<b>Literal name</b>')); assert(email.text.includes('<b>Literal name</b>'));
      assert.equal((await handleApi(context(req('/create-link', { ...body, amount: '-1.00' }, cookie)))).status, 400);
      assert.equal((await handleApi(context(req('/create-link', { ...body, amount: '20.00' }, cookie)))).status, 409);
      assert.equal((await handleApi(context(req('/create-link', { ...body, request_id: crypto.randomUUID() })))).status, 401);
    } finally { f.restore(); }
  });

  await t.test('twenty invoice attachments send once while count and byte limits remain enforced', async () => {
    const f = fixture();
    try {
      const cookie = await login();
      const pdf = (size = 32) => { const bytes = Buffer.alloc(size); bytes.write('%PDF-1.4'); return bytes.toString('base64'); };
      const files = Array.from({ length: 20 }, (_, index) => ({ filename: `invoice-${57000 + index}.pdf`, content: pdf() }));
      const body = { request_id: crypto.randomUUID(), order_number: Array.from({ length: 20 }, (_, index) => String(57000 + index)).join(', '), amount: '200.00', customer_name: 'Synthetic Buyer', company_name: '', customer_email: 'batch@example.invalid', send_email: true };
      assert.equal((await handleApi(context(req('/create-link', { ...body, attachments: [...files, { filename: 'invoice-57020.pdf', content: pdf() }] }, cookie)))).status, 400);
      assert.equal((await handleApi(context(req('/create-link', { ...body, attachments: [{ filename: 'large.pdf', content: pdf(5 * 1024 * 1024 + 1) }] }, cookie)))).status, 413);
      const maxSize = pdf(5 * 1024 * 1024);
      assert.equal((await handleApi(context(req('/create-link', { ...body, attachments: [{ filename: 'a.pdf', content: maxSize }, { filename: 'b.pdf', content: maxSize }, files[0]] }, cookie)))).status, 413);
      assert.equal(f.counts.create, 0); assert.equal(f.counts.email, 0);
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await handleApi(context(req('/create-link', { ...body, attachments: files }, cookie)));
        assert.equal(response.status, 200); assert.equal((await response.json()).email_status, 'accepted');
      }
      assert.equal(f.counts.create, 1); assert.equal(f.counts.email, 1);
      assert.deepEqual(f.requests.find((r) => r.host === 'api.resend.com').body.attachments, files);
      assert.equal(f.record().order_number, body.order_number); assert.equal(f.record().amount, '200.00');
    } finally { f.restore(); }
  });

  await t.test('copy-only links allow empty contacts through lookup and payment without inventing a recipient', async () => {
    const f = fixture();
    try {
      const cookie = await login();
      const body = { request_id: crypto.randomUUID(), order_number: 'COPY-ONLY', amount: '10.00', customer_name: '', customer_email: '', company_name: '', attachments: [], send_email: false };
      for (const invalid of [{ ...body, send_email: true }, { ...body, customer_name: 'Buyer', send_email: true }, { ...body, customer_email: 'buyer@example.invalid', send_email: true }, { ...body, customer_email: 'invalid' }]) {
        assert.equal((await handleApi(context(req('/create-link', invalid, cookie)))).status, 400);
      }
      assert.equal(f.counts.create, 0); assert.equal(f.counts.email, 0);
      for (let retry = 0; retry < 2; retry++) assert.equal((await handleApi(context(req('/create-link', body, cookie)))).status, 200);
      assert.equal(f.counts.create, 1); assert.equal(f.record().customer_name, ''); assert.equal(f.record().customer_email, '');
      const lookup = await handleApi(context(req(`/payment-link?id=${id}`)));
      assert.equal(lookup.status, 200); assert(validPaymentLink(await lookup.json()));
      const send = await handleApi(context(req('/send-link-email', { payment_link_id: id, request_id: crypto.randomUUID() }, cookie)));
      assert.equal(send.status, 409); assert.equal(f.emails.size, 0);
      const payment = await handleApi(context(req('/charge', { ...validPayment, attemptId: crypto.randomUUID() })));
      assert.equal(payment.status, 200); assert.equal((await payment.json()).receipt_sent, false);
      assert.equal(f.record().status, 'paid'); assert.equal(f.counts.auth, 1); assert.equal(f.counts.capture, 1);
      assert.equal(f.counts.email, 1);
      const email = f.requests.find(r => r.host === 'api.resend.com').body;
      assert.deepEqual(email.to, ['accounting@overnightprintingseattle.com', 'contact@overnightprintingseattle.com']);
      assert.equal([...f.emails.values()].filter(e => e.kind === 'customer_receipt').length, 0);
    } finally { f.restore(); }
  });

  await t.test('copy-only links retain supplied partial contact details and company without placeholders', async () => {
    for (const contact of [{ customer_name: 'Buyer', customer_email: '', company_name: '' }, { customer_name: '', customer_email: 'buyer@example.invalid', company_name: '' }, { customer_name: '', customer_email: '', company_name: 'Example Company' }]) {
      const f = fixture();
      try {
        const cookie = await login();
        const response = await handleApi(context(req('/create-link', { request_id: crypto.randomUUID(), order_number: 'PARTIAL', amount: '10.00', attachments: [], send_email: false, ...contact }, cookie)));
        assert.equal(response.status, 200); assert.equal(f.record().customer_name, contact.customer_name || contact.company_name); assert.equal(f.record().customer_email, contact.customer_email); assert.equal(f.counts.email, 0);
        const lookup = await handleApi(context(req(`/payment-link?id=${id}`))); assert.equal(lookup.status, 200); assert(validPaymentLink(await lookup.json()));
      } finally { f.restore(); }
    }
  });

  await t.test('dashboard queries and snapshots are bounded, nullable and literal', () => {
    assert.equal(dashboardQuery(new URLSearchParams('search=%25_%27')).search, "%_'");
    assert.equal(dashboardQuery(new URLSearchParams()).limit, 25);
    for (const query of ['offset=-1', 'limit=51', 'offset=1.5', 'offset=100001', 'limit=0', 'payment=bogus', 'email=bogus', 'limit=1&limit=2', `search=${'x'.repeat(101)}`]) assert.equal(dashboardQuery(new URLSearchParams(query)), null);
    assert(validDashboard(dashboard()));
    assert(!validDashboard({ ...dashboard(), links: [{ ...dashboard().links[0], amount: '-10.00' }] }));
    assert(!validDashboard({ ...dashboard(), summary: { ...dashboard().summary, unpaid_cents: Infinity } }));
  });

  await t.test('dashboard requires staff session and rejects bad filters before listing', async () => {
    const f = fixture();
    try {
      assert.equal((await handleApi(context(req('/staff-links')))).status, 401);
      assert.equal(f.requests.length, 0);
      const cookie = await login();
      assert.equal((await handleApi(context(req('/staff-links?limit=1000', undefined, cookie)))).status, 400);
      const response = await handleApi(context(req('/staff-links?search=%25_%27&payment=unpaid&email=unknown', undefined, cookie)));
      assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(await response.json(), dashboard());
      const body = f.requests.find((r) => r.path.endsWith('/portal_staff_dashboard')).body;
      assert.equal(body.p_search, "%_'"); assert.equal(body.p_payment, 'unpaid');
      assert.equal(f.counts.auth + f.counts.capture + f.counts.email, 0);
    } finally { f.restore(); }
  });

  await t.test('dashboard malformed data and rate limits fail closed', async () => {
    for (const option of [{ badDashboard: true }, { limited: true }]) {
      const limited = option.limited; option.limited = false;
      const f = fixture(option);
      try {
        const cookie = await login();
        option.limited = limited;
        const response = await handleApi(context(req('/staff-links', undefined, cookie)));
        assert.equal(response.status, option.limited ? 429 : 503);
        assert.equal((await response.json()).links, undefined);
      } finally { f.restore(); }
    }
  });

  await t.test('email tracking survives accepted retry and link-only recovery', async () => {
    for (const send of [true, false]) {
      const f = fixture();
      try {
        const cookie = await login();
        const body = { request_id: crypto.randomUUID(), order_number: 'EMAIL-TEST', amount: '10.00', customer_name: 'Synthetic buyer', customer_email: 'buyer@example.invalid', send_email: send };
        for (let i = 0; i < 2; i++) assert.equal((await (await handleApi(context(req('/create-link', body, cookie)))).json()).email_status, send ? 'accepted' : 'not_requested');
        assert.equal(f.counts.email, send ? 1 : 0);
        assert.equal(f.record().link_email_status, send ? 'accepted' : 'not_requested');
        assert(f.requests.filter((r) => r.body?.link_email_status).every((r) => new URLSearchParams(r.query).get('link_email_status') === 'eq.unknown'));
      } finally { f.restore(); }
    }
    const f = fixture({ failEmailTracking: true });
    try {
      const cookie = await login(); const requestId = crypto.randomUUID();
      const response = await handleApi(context(req('/create-link', { request_id: requestId, order_number: 'EMAIL-TEST', amount: '10.00', customer_name: 'Synthetic buyer', customer_email: 'buyer@example.invalid', send_email: true }, cookie)));
      assert.equal((await response.json()).email_status, 'pending');
      assert.equal(f.record().link_email_status, 'pending');
      assert.equal((await (await handleApi(context(req(`/create-link?request_id=${requestId}`, undefined, cookie)))).json()).email_status, 'pending');
    } finally { f.restore(); }
  });

  await t.test('an ambiguous email response remains unconfirmed', async () => {
    const f = fixture({ emailNetworkFailure: true });
    try {
      const cookie = await login();
      const response = await handleApi(context(req('/create-link', { request_id: crypto.randomUUID(), order_number: 'EMAIL-TEST', amount: '10.00', customer_name: 'Synthetic buyer', customer_email: 'buyer@example.invalid', send_email: true }, cookie)));
      assert.equal((await response.json()).email_status, 'pending');
      assert.equal(f.record().link_email_status, 'pending');
    } finally { f.restore(); }
  });

  await t.test('staff mail actions claim once, replay safely and reuse the existing link', async () => {
    const f = fixture();
    try {
      assert.equal((await handleApi(context(req('/send-link-email', { payment_link_id: id, request_id: crypto.randomUUID() })))).status, 401);
      assert.equal((await handleApi(context(req(`/staff-link?id=${id}`)))).status, 401);
      const cookie = await login(); const body = { payment_link_id: id, request_id: crypto.randomUUID() };
      const results = await Promise.all([handleApi(context(req('/send-link-email', body, cookie))), handleApi(context(req('/send-link-email', body, cookie)))]);
      assert(results.every((r) => r.status === 200)); assert.equal(f.counts.email, 1); assert.equal(f.counts.create, 0);
      assert.equal((await (await handleApi(context(req('/send-link-email', body, cookie)))).json()).email_status, 'accepted');
      assert.equal(f.counts.email, 1);
      const detail = await (await handleApi(context(req(`/staff-link?id=${id}`, undefined, cookie)))).json(); assert.equal(detail.emails.length, 1);
      await handleApi(context(req('/send-link-email', { ...body, request_id: crypto.randomUUID() }, cookie))); assert.equal(f.counts.email, 2); assert.equal(f.record().amount, '10.00');
      const keys = f.requests.filter((r) => r.host === 'api.resend.com'); assert.equal(keys.length, 2);
      const foreign = new Request('https://portal.invalid/send-link-email', { method: 'POST', headers: { Origin: 'https://foreign.invalid', Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal((await handleApi(context(foreign))).status, 403);
      for (const query of ['start=2026-02-30', 'start=2026-10-13&end=2026-10-12', 'view=bogus']) assert.equal(dashboardQuery(new URLSearchParams(query)), null);
    } finally { f.restore(); }
  });

  await t.test('copy-only invoices accept a later recipient, replay once and retain earlier recipient history', async () => {
    const f = fixture();
    try {
      const cookie = await login();
      await handleApi(context(req('/create-link', { request_id: crypto.randomUUID(), order_number: 'LATER', amount: '10.00', customer_name: '', customer_email: '', send_email: false }, cookie)));
      const before = { ...f.record() };
      const body = { payment_link_id: id, request_id: crypto.randomUUID(), customer_name: '  Later Buyer  ', customer_email: '  later@example.invalid  ' };
      for (const invalid of [{ customer_name: '' }, { customer_email: 'invalid' }, { customer_name: null }, { customer_name: 'x'.repeat(401) }, { amount: '11.00' }]) {
        assert.equal((await handleApi(context(req('/send-link-email', { ...body, ...invalid }, cookie)))).status, 400);
      }
      const partial = { payment_link_id: id, request_id: crypto.randomUUID(), customer_email: 'later@example.invalid' };
      assert.equal((await handleApi(context(req('/send-link-email', partial, cookie)))).status, 400);
      assert.equal((await handleApi(context(req('/send-link-email', body)))).status, 401);
      assert.equal(f.counts.email, 0); assert.equal(f.record().customer_email, '');
      for (let retry = 0; retry < 2; retry++) assert.equal((await (await handleApi(context(req('/send-link-email', body, cookie)))).json()).email_status, 'accepted');
      assert.equal(f.counts.email, 1); assert.equal(f.counts.create, 1);
      assert.equal(f.record().customer_name, 'Later Buyer'); assert.equal(f.record().customer_email, 'later@example.invalid');
      for (const key of ['id','amount','order_number','expires_at','status']) assert.equal(f.record()[key], before[key]);
      const sent = f.requests.find(request => request.host === 'api.resend.com').body;
      assert.deepEqual(sent.to, ['later@example.invalid']); assert(sent.text.includes(paymentPath(id))); assert.equal(sent.attachments, undefined);
      const changed = { ...body, customer_email: 'changed@example.invalid' };
      assert.equal((await handleApi(context(req('/send-link-email', changed, cookie)))).status, 409);
      assert.equal((await handleApi(context(req('/send-link-email', { ...changed, request_id: crypto.randomUUID() }, cookie)))).status, 200);
      assert.equal(f.counts.email, 2); assert.equal(f.record().customer_email, 'changed@example.invalid');
      assert.deepEqual(f.emails.get(body.request_id).recipients, ['later@example.invalid']);
      assert.equal((await (await handleApi(context(req('/send-link-email', body, cookie)))).json()).email_status, 'accepted');
      assert.equal(f.record().customer_email, 'changed@example.invalid'); assert.equal(f.counts.email, 2);
      assert.equal((await handleApi(context(req('/send-receipt-email', body, cookie)))).status, 400);
    } finally { f.restore(); }
  });

  await t.test('late recipient edits cannot bypass pending sends or payment lifecycle locks', async () => {
    for (const options of [{ emailNetworkFailure: true }, { record: { status: 'paid' } }, { record: { cancelled_at: new Date().toISOString() } }, { record: { expires_at: '2020-01-01' } }, { attempt: { state: 'unknown' } }]) {
      const f = fixture(options);
      try {
        const cookie = await login();
        const body = { payment_link_id: id, request_id: crypto.randomUUID(), customer_name: 'Later buyer', customer_email: 'later@example.invalid' };
        const response = await handleApi(context(req('/send-link-email', body, cookie)));
        if (options.emailNetworkFailure) {
          assert.equal((await response.json()).email_status, 'pending');
          const other = await handleApi(context(req('/send-link-email', { ...body, request_id: crypto.randomUUID(), customer_email: 'other@example.invalid' }, cookie)));
          assert.equal((await other.json()).email_status, 'pending'); assert.equal(f.counts.email, 1);
          assert.equal(f.record().customer_email, 'later@example.invalid');
        } else {
          assert.equal(response.status, 409); assert.equal(f.counts.email, 0); assert.equal(f.record().customer_email, 'audit@example.invalid');
        }
      } finally { f.restore(); }
    }
  });

  await t.test('unknown email locks survive new request IDs and reject paid or expired mail', async () => {
    for (const option of [{ emailNetworkFailure: true }, { record: { status: 'paid' } }, { record: { expires_at: '2020-01-01' } }]) {
      const f = fixture(option);
      try {
        const cookie = await login(); const body = { payment_link_id: id, request_id: crypto.randomUUID() };
        const first = await handleApi(context(req('/send-link-email', body, cookie)));
        if (option.emailNetworkFailure) {
          assert.equal((await first.json()).email_status, 'pending');
          for (const request_id of [body.request_id, crypto.randomUUID()]) assert.equal((await (await handleApi(context(req('/send-link-email', { ...body, request_id }, cookie)))).json()).email_status, 'pending');
          assert.equal(f.counts.email, 1);
        } else { assert.equal(first.status, 409); assert.equal(f.counts.email, 0); }
      } finally { f.restore(); }
    }
  });

  await t.test('a concurrently accepted email cannot be downgraded by a failed retry', async () => {
    const f = fixture({ emailFailure: true, concurrentEmailAccepted: true });
    try {
      const cookie = await login();
      const response = await handleApi(context(req('/create-link', { request_id: crypto.randomUUID(), order_number: 'EMAIL-TEST', amount: '10.00', customer_name: 'Synthetic buyer', customer_email: 'buyer@example.invalid', send_email: true }, cookie)));
      assert.equal((await response.json()).email_status, 'accepted');
      assert.equal(f.record().link_email_status, 'accepted');
    } finally { f.restore(); }
  });

  await t.test('paid receipts claim once, replay durably and never recharge or alert staff on resend', async () => {
    const f = fixture({ record: { status: 'paid', retref: '123456789012', paid_at: '2026-10-13T17:00:00Z' } });
    try {
      const cookie = await login(), body = { payment_link_id: id, request_id: crypto.randomUUID() };
      const results = await Promise.all([handleApi(context(req('/send-receipt-email', body, cookie))),handleApi(context(req('/send-receipt-email', body, cookie)))]);
      assert(results.every(r=>r.status===200)); assert.equal(f.counts.email,1);
      const message = f.requests.find(r=>r.host==='api.resend.com'&&r.body).body;
      assert.equal(message.subject,'Payment received: Invoice #AUDIT-001'); assert.deepEqual(message.to,['audit@example.invalid']);
      f.emails.get(body.request_id).created_at='2000-01-01T00:00:00Z';
      await handleApi(context(req('/send-receipt-email', body, cookie))); assert.equal(f.counts.email,1);
      await handleApi(context(req('/send-receipt-email', {...body,request_id:crypto.randomUUID()}, cookie))); assert.equal(f.counts.email,2);
      assert.equal(f.counts.auth+f.counts.capture+f.counts.create,0); assert.equal(f.record().amount,'10.00');
    }finally{f.restore();}
    for(const options of [{},{record:{status:'paid'},emailNetworkFailure:true}]) {
      const f=fixture(options);
      try {
        const cookie=await login(),body={payment_link_id:id,request_id:crypto.randomUUID()};
        const result=await handleApi(context(req('/send-receipt-email',body,cookie)));
        if(!options.record) {assert.equal(result.status,409);assert.equal(f.counts.email,0);}
        else {
          assert.equal((await result.json()).email_status,'pending');
          await handleApi(context(req('/send-receipt-email',{...body,request_id:crypto.randomUUID()},cookie)));assert.equal(f.counts.email,1);
          const check=await handleApi(context(req('/check-email-status',{payment_link_id:id,email_request_id:body.request_id},cookie)));
          assert.equal((await check.json()).code,'provider_review'); assert.equal(f.counts.emailCheck,0);
        }
      }finally{f.restore();}
    }
    const failed=fixture({failEmailTracking:true});
    try {const response=await handleApi(context(req('/charge',validPayment)));assert.equal(response.status,200);assert.equal((await response.json()).receipt_sent,false);assert.equal(failed.record().status,'paid');}finally{failed.restore();}
  });

  await t.test('signed webhooks verify exact bytes/time, bind recipients and survive persistence failure', async () => {
    // Public Svix documentation vector, not a portal credential.
    const vectorSecret='whsec_plJ3nmyCDGBKInavdOK15jsl',vectorBody='{"event_type":"ping","data":{"success":true}}';
    const vectorReq=new Request('https://portal.invalid/resend-webhook',{method:'POST',headers:{'svix-id':'msg_loFOjxBNrRLzqYUf','svix-timestamp':'1731705121','svix-signature':'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0='}});
    assert.equal((await verifyWebhook(vectorReq,vectorBody,vectorSecret,1731705121000)).event,null);
    const secret=`whsec_${btoa('synthetic-webhook-key-for-tests')}`;
    const sign=async (payload,event='msg_test',stamp=String(Math.floor(Date.now()/1000)))=>{
      const text=JSON.stringify(payload),key=await crypto.subtle.importKey('raw',new TextEncoder().encode('synthetic-webhook-key-for-tests'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
      const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${event}.${stamp}.${text}`)));
      return new Request('https://portal.invalid/resend-webhook',{method:'POST',headers:{'Content-Type':'application/json','svix-id':event,'svix-timestamp':stamp,'svix-signature':`v2,ignored v1,A v1,${btoa(String.fromCharCode(...bytes))}`},body:text});
    };
    const f=fixture({record:{status:'paid'}});
    try {
      const cookie=await login(),request_id=crypto.randomUUID();
      await handleApi(context(req('/send-receipt-email',{payment_link_id:id,request_id},cookie)));
      const mail=f.emails.get(request_id);
      const event={type:'email.delivered',created_at:new Date().toISOString(),data:{email_id:mail.provider_id,to:['audit@example.invalid'],tags:{portal_app:'payment_portal',portal_request:request_id,portal_link:id,portal_kind:'customer_receipt'}}};
      const bad=await sign(event);const altered=new Request(bad,{body:JSON.stringify(event)+' '});
      assert.equal((await handleApi(context(altered,{RESEND_WEBHOOK_SECRET:secret}))).status,400);
      for(const stamp of [String(Math.floor(Date.now()/1000)-301),String(Math.floor(Date.now()/1000)+301)]) assert.equal((await handleApi(context(await sign(event,'msg_stale',stamp),{RESEND_WEBHOOK_SECRET:secret}))).status,400);
      for(let i=0;i<2;i++) assert.equal((await handleApi(context(await sign(event),{RESEND_WEBHOOK_SECRET:secret}))).status,200);
      assert.equal(f.events.size,1);assert.equal(mail.delivery_status,'delivered');assert.equal(f.record().status,'pending');
      const wrong={...event,data:{...event.data,to:['other@example.invalid']}};
      await handleApi(context(await sign(wrong,'msg_wrong'),{RESEND_WEBHOOK_SECRET:secret}));assert.equal(f.events.size,1);
      assert.equal(f.counts.email,1); assert.equal(f.counts.auth+f.counts.capture,0);
      const check=await handleApi(context(req('/check-email-status',{payment_link_id:id,email_request_id:request_id},cookie)));
      assert.equal((await check.json()).email_status,'delivered'); assert.equal(f.counts.emailCheck,1); assert.equal(f.counts.email,1);
    }finally{f.restore();}
    const failure=fixture({eventFailure:true});
    try {
      const payload={type:'email.sent',created_at:new Date().toISOString(),data:{email_id:crypto.randomUUID(),to:['audit@example.invalid']}};
      const response=await handleApi(context(await sign(payload),{RESEND_WEBHOOK_SECRET:secret}));assert.equal(response.status,503);assert(!(await response.text()).includes('received'));
    }finally{failure.restore();}
  });

  await t.test('email status checking rejects mismatched provider recipients and pre-send read failures do not stay locked', async () => {
    const f=fixture({record:{status:'paid'},emailRetrieval:{to:['other@example.invalid']}});
    try {
      const cookie=await login(),request_id=crypto.randomUUID();
      await handleApi(context(req('/send-receipt-email',{payment_link_id:id,request_id},cookie)));
      assert.equal((await handleApi(context(req('/check-email-status',{payment_link_id:id,email_request_id:request_id},cookie)))).status,503);
      assert.equal(f.events.size,0);assert.equal(f.counts.email,1);
    }finally{f.restore();}
    const bad=fixture({record:{status:'paid',customer_name:'invalid\nname'}});
    try {
      const cookie=await login();const response=await handleApi(context(req('/send-receipt-email',{payment_link_id:id,request_id:crypto.randomUUID()},cookie)));
      assert.equal(response.status,404);assert.equal(bad.counts.email,0);assert.equal(bad.emails.size,0);
    }finally{bad.restore();}
  });

  await t.test('staff payment inquiry resolves expired review only on exact capture, with no new charge', async () => {
    for(const [captured,reference] of [[true,'123456789012'],[false,'123456789012'],[false,'123456789013']]) {
      const f=fixture({record:{expires_at:'2000-01-01T00:00:00Z'},attempt:{id:crypto.randomUUID(),order_id:'pffffffffffffffffff',amount:'10.00',state:'review',created_at:'2000-01-01T00:00:00Z',retref:'123456789012'},inquiry:{respstat:'A',retref:reference,amount:captured||reference==='123456789013'?'10.00':'9.00',setlstat:'Queued for Capture'}});
      try {
        const cookie=await login(),response=await handleApi(context(req('/check-payment',{payment_link_id:id},cookie))),data=await response.json();
        assert.equal(response.status,200);assert.equal(data.code,captured?'paid':'merchant_review');assert.equal(f.counts.auth+f.counts.capture,0);assert.equal(f.counts.inquiry,1);
        assert.equal(f.attempt().state,captured?'paid':'review');
      }finally{f.restore();}
    }
    const f=fixture({attempt:{id:crypto.randomUUID(),order_id:'pffffffffffffffffff',amount:'10.00',state:'processing',created_at:new Date().toISOString()}});
    try{const cookie=await login();const result=await (await handleApi(context(req('/check-payment',{payment_link_id:id},cookie)))).json();assert.equal(result.code,'still_processing');assert.equal(f.counts.inquiry,0);}finally{f.restore();}
  });

  await t.test('invoice operations and all-page CSV require staff and reject unsafe requests', async () => {
    const f=fixture();
    try {
      for(const path of ['/send-receipt-email','/check-payment','/check-email-status','/cancel-link','/replace-link']) assert.equal((await handleApi(context(req(path,{payment_link_id:id,request_id:crypto.randomUUID()})))).status,401);
      assert.equal((await handleApi(context(req('/staff-export')))).status,401);
      const cookie=await login();
      assert.equal((await handleApi(context(req('/cancel-link',{payment_link_id:id,amount:'1.00'},cookie)))).status,400);
      assert.equal((await handleApi(context(req('/replace-link',{payment_link_id:id,request_id:'invalid'},cookie)))).status,400);
      const foreign=new Request('https://portal.invalid/cancel-link',{method:'POST',headers:{Origin:'https://foreign.invalid',Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({payment_link_id:id})});
      assert.equal((await handleApi(context(foreign))).status,403);
      for(let i=0;i<2;i++) assert.equal((await handleApi(context(req('/cancel-link',{payment_link_id:id},cookie)))).status,200);
      const replaced=await (await handleApi(context(req('/replace-link',{payment_link_id:id,request_id:crypto.randomUUID()},cookie)))).json();assert(UUID.test(replaced.id));
      const exportResponse=await handleApi(context(req('/staff-export?search=CSV-&payment=unpaid&email=delivered&start=2026-10-01&end=2026-10-13&customer=email%3Acsv%40example.invalid',undefined,cookie)));
      assert.equal(exportResponse.status,200);assert.equal(exportResponse.headers.get('Content-Type'),'text/csv; charset=utf-8');assert.equal(exportResponse.headers.get('Cache-Control'),'no-store');
      const bytes=new Uint8Array(await exportResponse.arrayBuffer());assert.deepEqual([...bytes.slice(0,3)],[239,187,191]);
      const csv=new TextDecoder().decode(bytes);assert.equal(csv.split('\r\n').length,62);assert(csv.includes("\"'=HYPERLINK"));assert(!csv.includes('/pay/'));
      const rpc=f.requests.find(r=>r.path.endsWith('/portal_staff_export')).body;assert.equal(rpc.p_search,'CSV-');assert.equal(rpc.p_email,'delivered');assert.equal(rpc.p_start,'2026-10-01');assert.equal(rpc.p_customer,'email:csv@example.invalid');
      const protectedCsv=invoiceCsv([{...dashboard().links[0],order_number:' +SUM(1,2)',customer_name:'  \u0000=FORMULA()',customer_email:'quote"comma,name@example.invalid'}]);
      assert(protectedCsv.includes("\"' +SUM(1,2)\""));assert(protectedCsv.includes("\"'  \u0000=FORMULA()\""));assert(protectedCsv.includes('quote""comma,name'));
    }finally{f.restore();}
    const big=fixture({exportTooLarge:true});try{const cookie=await login();assert.equal((await handleApi(context(req('/staff-export',undefined,cookie)))).status,413);}finally{big.restore();}
  });

  await t.test('batch gates cover scanning, duplicates, mixed recipients and manual review', () => {
    const row = { status: 'success', attachment: { filename: 'synthetic.pdf' }, orderNumber: '123', amount: '10.00', customerName: 'Buyer', companyName: '', customerEmail: 'buyer@example.invalid' };
    assert.equal(batchIssue([row]), '');
    assert(batchIssue([{ ...row, status: 'scanning' }]));
    assert(batchIssue([row, { ...row }]));
    assert(batchIssue([row, { ...row, orderNumber: '456', customerEmail: 'other@example.invalid' }]));
    assert(batchIssue([{ ...row, status: 'review', attachment: null }]));
    assert.equal(batchIssue([{ ...row, status: 'review' }]), '');
    const company = { ...row, companyName: 'Example Company' };
    const contact = { ...company, orderNumber: '456', customerName: 'Other Buyer', customerEmail: 'other@example.invalid' };
    assert.equal(batchIssue([company, contact]), '');
    assert.equal(batchIssue([company, { ...contact, companyName: '  EXAMPLE   COMPANY  ', customerEmail: '', status: 'review' }]), '');
    assert(batchIssue([company, { ...contact, companyName: 'Other Company' }]));
    assert(batchIssue([company, { ...contact, companyName: '' }]));
    assert(batchIssue([company, { ...contact, orderNumber: company.orderNumber }]));
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
