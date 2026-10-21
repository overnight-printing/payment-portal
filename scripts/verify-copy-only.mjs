import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium, webkit } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'http://127.0.0.1:5179';
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(engine === chromium ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true } : { headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  let creations = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/create-link') creations++; });
  try {
    await page.goto(base + '/send');
    await page.locator('#orderNumber').fill('SAMPLE-80001');
    await page.locator('#amount').fill('100.00');
    await page.locator('button[value=send-email]').click();
    assert.equal(creations, 0);
    assert.equal(await page.locator('#customerName').evaluate(element => element.validity.valid), false);
    await page.locator('#customerName').fill('Sample Customer');
    await page.locator('button[value=send-email]').click();
    assert.equal(creations, 0);
    assert.equal(await page.locator('#customerEmail').evaluate(element => element.validity.valid), false);
    await page.locator('#customerName').fill('');
    await page.locator('#customerEmail').fill('invalid');
    await page.locator('button[value=link-only]').click();
    assert.equal(creations, 0, 'supplied invalid email must still be rejected');
    await page.locator('#customerEmail').fill('');
    const geometry = await page.locator('.staff-workspace').evaluate(element => {
      const box = element.getBoundingClientRect();
      const intake = element.querySelector('.staff-intake').getBoundingClientRect();
      const form = element.querySelector('form').getBoundingClientRect();
      return { width: box.width, aligned: Math.abs(intake.top - form.top) < 2, columns: form.left > intake.right };
    });
    assert.ok(geometry.width > 1200 && geometry.aligned && geometry.columns, JSON.stringify(geometry));
    await page.screenshot({ path: `.preview/copy-only-${engine.name()}-desktop.png`, fullPage: true });
    for (const width of [320, 393, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      if (width < 1200) assert.ok(await page.locator('.staff-workspace').evaluate(element => element.querySelector('form').getBoundingClientRect().top >= element.querySelector('.staff-intake').getBoundingClientRect().bottom));
      if (width === 393) await page.screenshot({ path: `.preview/copy-only-${engine.name()}-mobile.png`, fullPage: true });
    }
    await page.locator('button[value=link-only]').click();
    await page.getByLabel('Generated payment link').waitFor();
    assert.equal(creations, 1);
    const url = await page.getByLabel('Generated payment link').inputValue();
    await page.goto(url);
    await page.getByLabel('Name on card', { exact: true }).waitFor();
    assert.equal(await page.locator('#cardholderName').getAttribute('required'), '');
    await page.getByRole('button', { name: 'Pay $100.00', exact: true }).click();
    await page.getByText('Enter the name on the card, up to 30 characters.', { exact: true }).waitFor();
    assert.equal(await page.locator('#cvv').isVisible(), true);
    console.log(`${engine.name()}: direct-email requirements, blank copy-only creation/checkout, invalid optional email, required cardholder, full-width desktop and mobile reflow passed`);
  } finally { await browser.close(); }
}
