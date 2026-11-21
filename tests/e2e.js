// `npm run test:e2e`: drives the real page in Chromium against the local dev server and mock endpoint.
// Needs a browser: `npx playwright-core install chromium`, or set CHROMIUM_PATH to an existing Chrome/Chromium.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { start } = require('../dev');
(async () => {
  const { server, port } = await start({ port: 0, quiet: true, overrides: { gaId: 'G-E2ETEST' } });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ok = m => console.log('PASS  ' + m);
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const ga = []; const posts = []; const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('https://www.googletagmanager.com/**', r => { ga.push(r.request().url()); r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }); });
    page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/api/mock')) posts.push(JSON.parse(r.postData())); });
    await page.goto(`http://localhost:${port}/`);

    assert.ok(await page.isVisible('#cc')); assert.equal(ga.length, 0); ok('banner shows, analytics not loaded yet');
    await page.click('#cc-yes'); await page.waitForTimeout(200);
    assert.equal(ga.length, 1); assert.ok(!(await page.isVisible('#cc'))); ok('accepting loads analytics once');

    await page.click('#pricing .pc a >> nth=0'); assert.equal(await page.getAttribute('[data-t="quote"]', 'aria-pressed'), 'true'); ok('pricing card opens the quote tab');
    await page.click('nav .btn'); assert.equal(await page.getAttribute('[data-t="visit"]', 'aria-pressed'), 'true'); ok('nav "Book a visit" opens the visit tab');
    await page.click('.hero .btn >> text=Book a desk'); assert.equal(await page.getAttribute('[data-t="desk"]', 'aria-pressed'), 'true'); ok('hero "Book a desk" opens the desk tab');

    await page.fill('#name', 'Ada Obi'); await page.fill('#phone', '+234 801 234 5678'); await page.fill('#deskStart', '2030-01-07');
    await page.click('.go'); await page.waitForSelector('#done', { state: 'visible' });
    assert.equal(posts.length, 1); assert.equal(posts[0].type, 'desk'); assert.match(posts[0].source, /hero > desk/);
    assert.match(await page.innerText('#doneText'), /DEV-/); ok('desk form submits with type and source, shows reference');

    await page.click('footer >> text=Cookie settings'); assert.ok(await page.isVisible('#cc')); ok('cookie settings reopens the banner');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 800 } });
    await mobile.goto(`http://localhost:${port}/`);
    const over = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 1, `horizontal overflow of ${over}px on mobile`); ok('no sideways scrolling on a 390px phone');
    assert.deepEqual(errors, []); ok('no JavaScript errors');
  } catch (e) { console.error('FAIL  ' + e.message); process.exitCode = 1; }
  finally { await browser.close(); server.close(); }
})();
