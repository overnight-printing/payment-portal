import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { paymentPath, decodePaymentCode } from '../shared/payment-link.js';
const { chromium, webkit } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'http://127.0.0.1:5179';
const sampleId = '00000000-0000-4000-8000-000000000001';
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(engine === chromium ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true } : { headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { if (window.copyFails) throw Error('unavailable'); window.copiedLink = value; } } }));
  let publicReads = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/payment-link') publicReads++; });
  try {
    await page.goto(base + '/send');
    await page.locator('#orderNumber').fill('SAMPLE-80002'); await page.locator('#amount').fill('2596.96');
    await page.locator('button[value=link-only]').click();
    const result = page.getByRole('region', { name: 'Created payment link', exact: true });
    await result.getByText('Link ready', { exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent === 'Link ready');
    assert.equal(await page.locator('.staff-details-form').count(), 0);
    assert.equal(await result.locator('.link-result-amount').innerText(), '$2,596.96');
    assert.ok(await result.locator('.link-result-amount').evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 32));
    assert.ok(await result.locator('.link-result-invoice').evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 18));
    assert.ok(!/below|manually|generated/i.test(await result.innerText()));
    const url = await page.getByLabel('Generated payment link').inputValue();
    assert.match(new URL(url).pathname, /^\/p\/[A-Za-z0-9_-]{22}$/);
    const id = decodePaymentCode(new URL(url).pathname.slice(3));
    assert.equal(await result.getByRole('link', { name: 'View invoice', exact: true }).getAttribute('href'), '/invoices?invoice=' + id);
    for (const width of [1600, 1440, 1024, 768, 393, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      assert.ok(await result.getByRole('button', { name: 'Copy link', exact: true }).evaluate(element => element.getBoundingClientRect().height >= 44));
      if ([1600,393].includes(width)) await page.screenshot({ path: `.preview/readable-result-${engine.name()}-${width}.png`, fullPage: true });
    }
    const largeText = await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
    await largeText.evaluate(element => element.remove());
    await page.setViewportSize({ width: 1600, height: 1000 });
    await result.getByRole('button', { name: 'Copy link', exact: true }).click();
    await page.waitForFunction(value => window.copiedLink === value, url);
    await page.evaluate(() => { window.copyFails = true; });
    await result.getByRole('button', { name: 'Copied', exact: true }).click();
    await result.getByText('Select the link to copy it.', { exact: true }).waitFor();
    await result.getByRole('link', { name: 'View invoice', exact: true }).click();
    await page.locator('#invoice-detail-link').waitFor();
    assert.equal(await page.locator('#invoice-detail-link').inputValue(), url);
    assert.equal(await page.getByRole('link', { name: 'Open payment link', exact: true }).getAttribute('href'), paymentPath(id));
    for (const path of [new URL(url).pathname, '/pay/' + id]) {
      await page.goto(base + path); await page.getByLabel('Name on card', { exact: true }).waitFor();
      assert.equal(await page.getByRole('region', { name: 'Invoice summary', exact: true }).count(), 1);
    }
    const reads = publicReads;
    await page.goto(base + '/p/' + 'A'.repeat(21) + 'B');
    await page.getByRole('heading', { name: 'Payment link unavailable', exact: true }).waitFor(); assert.equal(publicReads, reads);
    await page.goto(base + paymentPath('00000000-0000-4000-8000-000000000002'));
    await page.getByRole('heading', { name: 'Payment received', exact: true }).waitFor();
    await page.goto(base + paymentPath('00000000-0000-4000-8000-000000000003'));
    await page.getByRole('button', { name: 'Check payment status', exact: true }).waitFor();
    for (const [state, label, warning] of [['failed','Email failed','Copy the link or retry from the invoice.'],['pending','Email unconfirmed','Check email status before resending.'],['accepted','Email accepted',null]]) {
      await page.route('**/create-link', route => route.request().method() === 'POST' ? route.fulfill({ json: { id: sampleId, email_status: state } }) : route.continue());
      await page.goto(base + '/send');
      await page.locator('#orderNumber').fill('SAMPLE-80003'); await page.locator('#amount').fill('10.00');
      await page.locator('#customerName').fill('Sample Customer'); await page.locator('#customerEmail').fill('sample@example.invalid');
      await page.locator('button[value=send-email]').click();
      await result.getByText(label, { exact: true }).waitFor();
      if (warning) await result.getByText(warning, { exact: true }).waitFor();
      await result.getByRole('button', { name: 'Send another', exact: true }).click();
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Upload invoices');
      await page.unroute('**/create-link');
    }
    console.log(`${engine.name()}: readable result, grouped amount, compact copy/fallback, email states, reset/focus, dashboard URLs, old/short/paid/pending/invalid routes and responsive layout passed`);
  } finally { await browser.close(); }
}
