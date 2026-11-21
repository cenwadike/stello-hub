// Static checks on the built site. No browser needed.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { build } = require('../build');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-'));
build({ dev: true, outDir: out, codeOut: path.join(out, 'Code.gs') });
const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const body = html.replace(/<style>[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '');

test('no template tokens left in any output', () => {
  for (const f of ['index.html', 'privacy.html', '404.html', 'robots.txt', 'sitemap.xml', 'Code.gs'])
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(fs.readFileSync(path.join(out, f), 'utf8')), f);
});
test('title is present and a sensible length', () => {
  const t = html.match(/<title>(.*?)<\/title>/)[1]; assert.ok(t.length > 20 && t.length <= 65, `${t.length} chars: ${t}`);
});
test('meta description is 70 to 160 characters', () => {
  const d = html.match(/name="description" content="(.*?)"/)[1]; assert.ok(d.length >= 70 && d.length <= 160, `${d.length} chars`);
});
test('has lang, viewport, canonical, Open Graph', () => {
  for (const re of [/<html lang="en"/, /name="viewport"/, /rel="canonical"/, /property="og:title"/, /property="og:image"/]) assert.match(html, re);
});
test('exactly one h1, and headings never skip a level', () => {
  const levels = [...body.matchAll(/<h([1-6])[\s>]/g)].map(m => +m[1]);
  assert.equal(levels.filter(l => l === 1).length, 1);
  levels.reduce((prev, l) => { assert.ok(l <= prev + 1, `h${prev} then h${l}`); return l; }, 1);
});
test('every #anchor link points at a real id', () => {
  const ids = new Set([...body.matchAll(/ id="([^"]+)"/g)].map(m => m[1]));
  for (const m of body.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(m[1]), `#${m[1]}`);
});
test('every data-type button maps to a form tab', () => {
  const tabs = new Set([...body.matchAll(/data-t="(\w+)"/g)].map(m => m[1]));
  assert.deepEqual([...tabs].sort(), ['course', 'desk', 'quote', 'visit']);
  for (const m of body.matchAll(/data-type="(\w+)"/g)) assert.ok(tabs.has(m[1]), m[1]);
});
test('images have alt text', () => { for (const m of body.matchAll(/<img\b[^>]*>/g)) assert.match(m[0], /alt="[^"]+"/); });
test('structured data parses; FAQ schema matches the visible FAQ', () => {
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(ld.map(x => x['@type']), ['LocalBusiness', 'FAQPage']);
  assert.equal(ld[1].mainEntity.length, [...body.matchAll(/<div class="q">/g)].length);
});
test('analytics is not loaded before consent', () => {
  assert.ok(!/<script[^>]+googletagmanager/.test(html)); assert.match(html, /id="cc"/);
  assert.match(html, /Accept analytics/); assert.match(html, />Decline</);
});
test('form has the required fields and honeypot', () => {
  for (const n of ['name', 'phone', 'email', 'website']) assert.match(html, new RegExp(`name="${n}"`));
});
test('robots and sitemap reference each other', () => {
  assert.match(fs.readFileSync(path.join(out, 'robots.txt'), 'utf8'), /Sitemap: https?:\/\/.+\/sitemap\.xml/);
  assert.match(fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8'), /<loc>https?:\/\/.+\/<\/loc>/);
});
test('pricing: five priced cards in naira, and every card opens the quote form', () => {
  const sec = body.match(/<section id="pricing">[\s\S]*?<\/section>/)[0];
  assert.equal((sec.match(/class="amt">from \u20A6[\d,]+/g) || []).length, 5);
  assert.equal((sec.match(/data-type="quote"/g) || []).length, 6);
});
