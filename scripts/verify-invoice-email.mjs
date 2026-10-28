import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { decodePaymentCode } from '../shared/payment-link.js';
const { chromium, webkit } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'http://127.0.0.1:5179';
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch(engine === chromium ? { executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true } : { headless:true });
  const page = await browser.newPage({ viewport:{width:1440,height:1000} });
  page.setDefaultTimeout(15000);
  let mode='hold', release;
  const bodies=[];
  await page.route('**/send-link-email', async route => {
    bodies.push(route.request().postDataJSON());
    if(mode==='hold') await new Promise(resolve => {release=resolve;});
    if(mode==='uncertain') return route.fulfill({status:503,json:{code:'unavailable'}});
    if(mode==='failed') { const response=await route.fetch({headers:{...route.request().headers(),cookie:'preview_email=failed'}}); return route.fulfill({response}); }
    return route.continue();
  });
  const composer=page.getByRole('form',{name:'Email payment link',exact:true});
  const openComposer=()=>page.getByRole('button',{name:/^(Re)?send email$/i}).click();
  const sent=()=>page.getByText('Email accepted for sending.',{exact:true}).waitFor();
  try {
    await page.goto(base+'/send');
    await page.locator('#orderNumber').fill('SAMPLE-LATER-57649'); await page.locator('#amount').fill('1296.96');
    await page.locator('button[value=link-only]').click();
    const link=await page.getByLabel('Generated payment link').inputValue();
    const id=decodePaymentCode(new URL(link).pathname.slice(3));
    await page.getByRole('link',{name:'View invoice',exact:true}).click(); await openComposer();
    await page.waitForFunction(()=>document.activeElement?.id==='invoice-recipient-name');
    await composer.getByRole('button',{name:'Send email',exact:true}).click(); assert.equal(bodies.length,0);
    await composer.getByLabel('Name',{exact:true}).fill('Sample Buyer');
    await composer.getByLabel('Email',{exact:true}).fill('invalid');
    await composer.getByRole('button',{name:'Send email',exact:true}).click(); assert.equal(bodies.length,0);
    await composer.getByRole('button',{name:'Cancel',exact:true}).click();
    await openComposer(); assert.equal(await composer.getByLabel('Name',{exact:true}).inputValue(),'');
    await composer.getByLabel('Name',{exact:true}).fill('Sample Buyer'); await composer.getByLabel('Email',{exact:true}).fill('buyer@example.invalid');
    for(const width of [1440,768,393,320]) {
      await page.setViewportSize({width,height:1000});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
      if([1440,393].includes(width)) { await composer.scrollIntoViewIfNeeded(); await page.screenshot({path:`.preview/invoice-email-${engine.name()}-${width}.png`,fullPage:false}); }
    }
    await composer.evaluate(form=>{form.requestSubmit();form.requestSubmit();});
    await page.waitForFunction(()=>document.querySelector('#invoice-recipient-email')?.disabled===true);
    assert.equal(bodies.length,1); assert.equal(bodies[0].payment_link_id,id);
    assert.equal(await page.getByRole('button',{name:'Close invoice details',exact:true}).isDisabled(),true);
    mode='send'; release(); await sent();
    await page.getByRole('button',{name:'Resend email',exact:true}).waitFor();
    assert.equal(await page.locator('#invoice-detail-link').inputValue(),link);
    await openComposer(); assert.equal(await composer.getByLabel('Name',{exact:true}).inputValue(),'Sample Buyer');
    assert.equal(await composer.getByLabel('Email',{exact:true}).inputValue(),'buyer@example.invalid');
    await composer.getByLabel('Email',{exact:true}).fill('changed@example.invalid'); mode='uncertain';
    await composer.getByRole('button',{name:'Send email',exact:true}).click();
    await composer.getByRole('button',{name:'Check send status',exact:true}).waitFor();
    assert.equal(await composer.getByLabel('Email',{exact:true}).isDisabled(),true);
    mode='send'; await composer.getByRole('button',{name:'Check send status',exact:true}).click(); await sent();
    assert.deepEqual(bodies[1],bodies[2]); assert.notEqual(bodies[0].request_id,bodies[1].request_id);
    await page.getByRole('button',{name:'Resend email',exact:true}).waitFor();
    mode='failed';
    await openComposer(); await composer.getByRole('button',{name:'Send email',exact:true}).click();
    await page.getByText('Email was not accepted. Check the recipient and try again.',{exact:true}).waitFor();
    await composer.getByLabel('Email',{exact:true}).waitFor(); assert.equal(await composer.getByLabel('Email',{exact:true}).isDisabled(),false);
    assert.equal(await composer.getByLabel('Email',{exact:true}).inputValue(),'changed@example.invalid');
    await composer.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.getByRole('button',{name:'Cancel payment link',exact:true}).click();
    await page.getByRole('button',{name:'Confirm cancellation',exact:true}).click();
    await page.getByText('Payment link cancelled.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:/^(Re)?send email$/i}).count(),0);
    for(const [suffix,receipt] of [['000000000002',true],['000000000003',false],['000000000004',false]]) {
      await page.goto(base+'/invoices?invoice=00000000-0000-4000-8000-'+suffix);
      await page.locator('#invoice-detail-link').waitFor();
      assert.equal(await page.getByRole('button',{name:/^(Re)?send email$/i}).count(),0);
      if(receipt) assert.equal(await page.getByRole('button',{name:/^(Re)?send receipt$/i}).count(),1);
    }
    console.log(`${engine.name()}: blank-copy invoice -> composer, validation/focus/cancel, same URL, saved/editable recipient, duplicate lock, uncertain retry identity, failed-send edits, receipt/lifecycle gates and mobile fit passed`);
  } catch(error) { console.log(engine.name(),{requests:bodies.length,messages:await page.locator('.detail-message').allTextContents(),buttons:await page.locator('.invoice-email-action button').allTextContents()}); throw error; } finally {await browser.close();}
}
