import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// A separate localhost-only demo instance; no real service bindings exist.
test('local preview uses synthetic endpoints and name validation', async () => {
  const port = 5177;
  const process = spawn('node', ['scripts/preview.mjs'], { env: { ...globalThis.process.env, PREVIEW_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await Promise.race([once(process.stdout, 'data'), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Preview did not start')), 5000); timer.unref(); })]);
    const base = `http://127.0.0.1:${port}`;
    const id = '00000000-0000-4000-8000-000000000001';
    const invoice = await (await fetch(`${base}/payment-link?id=${id}`)).json();
    assert.equal(invoice.customer_email, 'customer@example.invalid'); assert.equal(invoice.status, 'pending');
    const frame = await (await fetch(`${base}/itoke/ajax-tokenizer.html`)).text();
    assert(frame.includes('Select sample card')); assert(!frame.includes('type="password"'));
    const payment = (cardholderName) => fetch(`${base}/charge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentLinkId: id, cardholderName }) });
    assert.equal((await payment('')).status, 400);
    const paid = await (await payment('Different Sample Cardholder')).json();
    assert.equal(paid.success, true); assert.equal(paid.receipt_sent, false);
    assert.equal((await (await fetch(`${base}/payment-link?id=00000000-0000-4000-8000-000000000004`)).json()).status, 'expired');
    const history = await (await fetch(`${base}/staff-links`)).json();
    assert.equal(history.links.length, 25); assert.equal(history.summary.total, 40);
    assert.equal((await fetch(`${base}/staff-links`, { headers: { Cookie: 'preview_session=out' } })).status, 401);
  } finally { process.kill('SIGTERM'); await once(process, 'exit'); }
});
