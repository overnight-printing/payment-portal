import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { paymentPath } from '../shared/payment-link.js';
const { chromium, webkit } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'http://127.0.0.1:5179';
const id = '00000000-0000-4000-8000-000000000001';
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(engine === chromium ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true } : { headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(15000);
  let status = 'pending', mode = 'decline', charges = 0, finishCharge;
  let customer = 'Sample Customer (Example Printing Co.)', order = 'SAMPLE-57649';
  await page.route('**/payment-link?*', route => route.fulfill({ json: { id, tokenizer_origin: base, order_number: order, amount: '2596.96', currency: 'USD', customer_name: customer, customer_email: '', status, retref: status === 'paid' ? 'sample-receipt' : '', paid_at: status === 'paid' ? '2026-10-26T18:00:00Z' : null, receipt_sent: false } }));
  await page.route('**/charge', async route => {
    charges++;
    if (mode === 'decline') return route.fulfill({ status: 402, json: { success: false } });
    if (mode === 'network') { status = 'processing'; return route.abort(); }
    if (mode === 'hold') await new Promise(resolve => { finishCharge = resolve; });
    status = 'paid'; return route.fulfill({ json: { success: true, retref: 'sample-receipt', paid_at: '2026-10-26T18:00:00Z', receipt_sent: false } });
  });
  const open = async () => { await page.goto(base + paymentPath(id)); await page.getByLabel('Name on card', { exact: true }).waitFor(); };
  const sampleCard = () => page.frameLocator('#tokenFrame').getByRole('button', { name: 'Select sample card', exact: true }).click();
  const fill = async () => {
    await page.locator('#cardholderName').fill('Sample Cardholder'); await sampleCard();
    await page.locator('#expiry').fill('1230'); await page.locator('#cvv').fill('123'); await page.locator('#zip').fill('98101');
  };
  try {
    await open();
    const hostedUrl = await page.locator('#tokenFrame').getAttribute('src');
    for (const width of [1440, 1024, 800, 768, 393, 375, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      const native = await page.locator('#cardholderName').evaluate(el => { const r=el.getBoundingClientRect(),s=getComputedStyle(el);return { left:r.left+parseFloat(s.borderLeftWidth)+parseFloat(s.paddingLeft),height:r.height }; });
      const outer = await page.locator('#tokenFrame').boundingBox();
      const inner = await page.frameLocator('#tokenFrame').locator('#ccnumfield').evaluate(el => { const r=el.getBoundingClientRect(),s=getComputedStyle(el);return { left:r.left+parseFloat(s.paddingLeft),height:r.height }; });
      assert.ok(Math.abs(native.left-outer.x-inner.left)<1, JSON.stringify({ engine:engine.name(),width,native,outer,inner }));
      assert.equal(native.height, 50); assert.equal(inner.height, 48);
      assert.ok(await page.locator('#cvv').evaluate(el => el.getBoundingClientRect().right <= document.documentElement.clientWidth));
      if ([1440,393].includes(width)) await page.screenshot({ path: `.preview/checkout-${engine.name()}-${width}.png`, fullPage: true });
    }
    await page.locator('#cardholderName').focus(); await page.keyboard.press('Tab');
    await page.waitForFunction(() => document.activeElement?.id === 'tokenFrame');
    assert.equal(await page.frameLocator('#tokenFrame').locator('#ccnumfield').evaluate(el => getComputedStyle(el).outlineWidth),'2px');
    const large = await page.addStyleTag({ content: 'html { font-size:200%; }' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
    await large.evaluate(el => el.remove());
    await page.getByRole('button', { name:'Pay $2,596.96', exact:true }).click();
    await page.waitForFunction(() => document.activeElement?.id === 'cardholderName'); assert.equal(charges,0);
    await fill(); await page.getByRole('button', { name:'Pay $2,596.96', exact:true }).click();
    await page.getByText('Your card was declined. Re-enter the card details or try another card.', { exact:true }).waitFor();
    assert.equal(await page.locator('#cvv').inputValue(), ''); assert.equal(charges,1);
    mode='network'; await fill(); await page.getByRole('button', { name:'Pay $2,596.96', exact:true }).click();
    await page.getByRole('button', { name:'Check payment status', exact:true }).waitFor();
    assert.equal(await page.locator('.payment-form').count(),0); assert.equal(charges,2);
    status='paid'; await page.getByRole('button', { name:'Check payment status', exact:true }).click();
    await page.getByRole('heading', { name:'Payment received', exact:true }).waitFor(); assert.equal(charges,2);
    status='pending'; mode='hold'; await open(); await fill();
    await page.locator('.payment-form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    await page.waitForFunction(() => document.querySelector('.payment-form')?.getAttribute('aria-busy') === 'true');
    for (let attempts=0; !finishCharge && attempts<50; attempts++) await new Promise(resolve => setTimeout(resolve,20));
    assert.ok(finishCharge); assert.equal(charges,3); finishCharge();
    await page.getByRole('heading', { name:'Payment received', exact:true }).waitFor();
    status='pending'; customer=''; await open(); assert.equal(await page.locator('.checkout-billing').count(),0);
    customer='Sample customer '.repeat(20); order=Array.from({ length:20 },(_,i)=>57600+i).join(', '); await open();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth),320);
    if (engine === chromium) {
      const actual = await browser.newPage({ viewport:{ width:400,height:80 } });
      const provider = new URL(hostedUrl);
      await actual.goto('https://fts.cardconnect.com/itoke/ajax-tokenizer.html' + provider.search);
      await actual.waitForFunction(() => getComputedStyle(document.querySelector('#ccnumfield')).height === '48px');
      const geometry = await actual.locator('#ccnumfield').evaluate(el => ({ left:el.getBoundingClientRect().left,height:el.getBoundingClientRect().height,margin:getComputedStyle(document.body).margin,padding:getComputedStyle(el).padding }));
      assert.deepEqual(geometry,{left:0,height:48,margin:'0px',padding:'0px'});
      await actual.locator('#ccnumfield').focus();
      assert.equal(await actual.locator('#ccnumfield').evaluate(el => getComputedStyle(el).outlineWidth),'2px');
      await actual.close();
      console.log('Actual empty CardPointe field: sanitizer-applied margin/padding reset and 48px alignment verified; no card data entered.');
    }
    console.log(`${engine.name()}: invoice hierarchy, hosted/native alignment, mobile/CVV/200% reflow, optional/long billing, validation, decline/reload, network recovery, paid receipt and duplicate-submit guard passed`);
  } finally { await browser.close(); }
}
