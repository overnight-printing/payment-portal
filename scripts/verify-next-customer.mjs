import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium, webkit } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'http://127.0.0.1:5178';

function invoice(number, customer, email) {
  const stream = `BT /F1 12 Tf 40 740 Td (No: ${number}) Tj 0 -24 Td (Ship To:) Tj 0 -24 Td (${customer}) Tj 0 -24 Td (${customer} Company) Tj 0 -24 Td (E-Mail: ${email}) Tj 0 -24 Td (AMOUNT DUE $10.00) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let content = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(content)); content += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return { name: `${number}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(content) };
}

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(engine === chromium ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true } : { headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise(resolve => { window.finishCopy = resolve; }) } }));
  const bodies = []; let delayed = false; let release; let uncertain = false;
  await page.route('**/create-link', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    bodies.push(route.request().postDataJSON());
    if (delayed) await new Promise(resolve => { release = resolve; });
    return route.fulfill({ status: uncertain ? 503 : 200, contentType: 'application/json', body: uncertain ? '{}' : JSON.stringify({ id: `00000000-0000-4000-8000-${String(bodies.length).padStart(12, '0')}`, email_status: bodies.at(-1).send_email ? 'accepted' : 'not_requested' }) });
  });
  const ready = n => page.waitForFunction(n => document.querySelectorAll('.invoice-item-row.success').length === n && !document.querySelector('.invoice-item-row.scanning'), n);
  const upload = async files => { await page.locator('input[type=file]').setInputFiles(files); await ready(files.length); };
  const drop = files => page.evaluate(files => {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.mimeType }));
    document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, files.map(file => ({ ...file, buffer: undefined, bytes: [...file.buffer] })));
  const sent = () => page.getByRole('region', { name: 'Created payment link', exact: true }).waitFor();
  try {
    await page.goto(base + '/send'); await page.getByRole('button', { name: 'Upload invoices', exact: true }).waitFor();
    const first = [invoice(80001, 'Alice', 'alice@example.invalid'), invoice(80002, 'Alice', 'alice@example.invalid')];
    const second = [invoice(80003, 'Bob', 'bob@example.invalid'), invoice(80004, 'Bob', 'bob@example.invalid'), invoice(80005, 'Bob', 'bob@example.invalid')];
    await upload(first); await page.locator('#customerName').fill('Alice manual edit');
    await page.locator('button[value=send-email]').click(); await sent();
    await page.getByRole('button', { name: 'Copy link', exact: true }).click(); await page.waitForFunction(() => Boolean(window.finishCopy));
    await page.locator('input[type=file]').setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
    assert.equal(await page.getByLabel('Generated payment link').count(), 1);
    await drop(second); await ready(3);
    assert.equal(await page.getByLabel('Generated payment link').count(), 0, 'old customer result must disappear when next batch starts');
    assert.equal(await page.locator('#customerName').inputValue(), 'Bob');
    assert.equal(await page.locator('#customerEmail').inputValue(), 'bob@example.invalid');
    assert.equal(await page.locator('#amount').inputValue(), '30.00');
    await page.locator('button[value=send-email]').click(); await sent(); await page.evaluate(() => window.finishCopy());
    await page.getByRole('button', { name: 'Copy link', exact: true }).waitFor();
    assert.notEqual(bodies[0].request_id, bodies[1].request_id);
    assert.deepEqual(bodies[1].attachments.map(file => file.filename), second.map(file => file.name));
    assert.equal(bodies[1].customer_email, 'bob@example.invalid'); assert.equal(bodies[1].amount, '30.00');
    for (const width of [320, 393, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    }
    await page.getByRole('button', { name: 'Send another', exact: true }).click();
    assert.equal(await page.getByLabel('Generated payment link').count(), 0); assert.equal(await page.locator('.invoice-item-row').count(), 0);
    for (const id of ['orderNumber', 'amount', 'customerName', 'companyName', 'customerEmail']) assert.equal(await page.locator('#' + id).inputValue(), '');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Upload invoices');
    await upload(first); delayed = true;
    await page.locator('button[value=link-only]').click(); await page.getByText('Generating link…', { exact: false }).waitFor();
    await drop(second); assert.equal(await page.locator('.invoice-item-row').count(), 2);
    assert.equal(await page.getByRole('button', { name: 'Send another', exact: true }).count(), 0);
    delayed = false; release(); await sent();
    await upload(second); uncertain = true;
    await page.locator('button[value=send-email]').click(); await page.getByRole('button', { name: 'Recover existing request', exact: true }).waitFor();
    const requestId = bodies.at(-1).request_id; await drop(first);
    assert.equal(await page.locator('.invoice-item-row').count(), 3); assert.equal(await page.getByRole('button', { name: 'Send another', exact: true }).count(), 0);
    uncertain = false; await page.getByRole('button', { name: 'Recover existing request', exact: true }).click(); await sent();
    assert.equal(bodies.at(-1).request_id, requestId); assert.equal(bodies.at(-1).customer_email, 'bob@example.invalid');
    console.log(`${engine.name()}: consecutive customers, multi-file reset, distinct requests, explicit reset/focus, stale clipboard, mobile and pending/uncertain recovery guards passed`);
  } finally { await browser.close(); }
}
