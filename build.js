// Builds dist/ (the website) and build/Code.gs (the Google script) from src/ + site.config.json. No dependencies.
const fs = require('fs'), path = require('path');
const ROOT = __dirname;
const TEXT = new Set(['.html', '.txt', '.xml', '.json', '']);   // '' = files like _headers
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const js = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const pad = n => String(n).padStart(2, '0');

// Reads <meta name="..." content="..."> however it is laid out (formatters split tags over lines)
function meta(html, name) {
  const tag = html.match(new RegExp(`<meta\\b[^>]*?\\bname=["']${name}["'][^>]*>`, 'i'));
  const m = tag && tag[0].match(/\bcontent=(?:"([^"]*)"|'([^']*)')/i);
  return m ? (m[1] ?? m[2]).replace(/\s+/g, ' ').trim() : null;
}
const squash = s => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function render(tpl, vals, raw = new Set(), file = '') {
  return tpl.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => {
    if (!(k in vals)) throw new Error(`Unknown token {{${k}}} in ${file}`);
    return raw.has(k) ? vals[k] : esc(vals[k]);
  });
}

function build({ dev = false, outDir = path.join(ROOT, 'dist'), codeOut = path.join(ROOT, 'build', 'Code.gs'), overrides = {} } = {}) {
  const cfg = { ...JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8')), ...overrides };
  if (dev) cfg.endpoint = '/api/mock';
  const lastMin = cfg.closeHour * 60 - cfg.visitMinutes;
  const vals = {
    NAME: cfg.name, CITY: cfg.city, COUNTRY: cfg.country, STREET: cfg.street, DOMAIN: cfg.domain.replace(/\/$/, ''),
    PHONE: cfg.phone, PHONE_TEL: cfg.phone.replace(/[^\d+]/g, ''), WHATSAPP: cfg.whatsapp, EMAIL: cfg.email,
    OWNER_EMAIL: cfg.ownerEmail, TZ: cfg.timezone, VISIT_MINUTES: cfg.visitMinutes,
    OPEN_HOUR: cfg.openHour, CLOSE_HOUR: cfg.closeHour, CLOSED_DAYS: cfg.closedDays.join(', '),
    OPEN_TIME: `${pad(cfg.openHour)}:00`, LAST_SLOT: `${pad(Math.floor(lastMin / 60))}:${pad(lastMin % 60)}`,
    HOURS_TEXT: cfg.hoursText, HOURS_SHORT: cfg.hoursShort, ENDPOINT: cfg.endpoint, GA_ID: cfg.gaId,
    DAY_PASS_PRICE: cfg.dayPassPrice, RETENTION: cfg.retention, UPDATED: new Date().toISOString().slice(0, 10),
    JSONLD: '',
    BUDGET_OPTIONS: cfg.budgetRanges.map(b => `<option>${esc(b)}</option>`).join(''),
    COURSE_OPTIONS: cfg.courses.map(c => `<option>${esc(c.name)}</option>`).join(''),
    COURSE_ROWS: cfg.courses.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.length)}</td><td><span class="pill">${esc(c.level)}</span></td><td>${esc(c.starts)}</td><td>${esc(c.fee)}</td></tr>`).join('\n    '),
    PRODUCT_ITEMS: cfg.products.map(p => `<div class="prod"><span class="status${/^live/i.test(p.status) ? '' : ' s'}">${esc(p.status)}</span><h3>${esc(p.name)}</h3><p>${esc(p.blurb)}</p></div>`).join('\n      '),
    PROOF_ITEMS: cfg.proof.map(t => `<li>${esc(t)}</li>`).join('\n    ')
  };
  const fmt = n => '\u20A6' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const label = p => p.price == null ? 'Custom quote' : `from ${fmt(p.price)}${p.period ? '/' + p.period : ''}`;
  vals.PRICING_NOTE = cfg.pricing.note;
  vals.PRICE_CARDS = cfg.pricing.items.map(p => `<div class="pc${p.price == null ? ' q' : ''}"><span class="cat">${esc(p.category)}</span><h3>${esc(p.name)}</h3><p class="amt">${esc(label(p))}</p><p>${esc(p.description)}</p>${p.includes ? `<p class="inc">${esc(p.includes)}</p>` : ''}<a href="#request" data-type="${esc(p.type)}" data-from="pricing-${esc(p.id)}">${p.price == null ? 'Request a quote' : 'Get a quote'}</a></div>`).join('\n    ');
  for (const p of cfg.pricing.items) if (p.price != null) vals['PRICE_' + p.id.toUpperCase()] = fmt(p.price);
  const raw = new Set(['PRICE_CARDS', 'PRICING_NOTE', 'BUDGET_OPTIONS', 'COURSE_OPTIONS', 'COURSE_ROWS', 'PRODUCT_ITEMS', 'PROOF_ITEMS', 'JSONLD']);

  fs.rmSync(outDir, { recursive: true, force: true });
  (function walk(dir, rel = '') {
    fs.mkdirSync(path.join(outDir, rel), { recursive: true });
    for (const f of fs.readdirSync(path.join(dir, rel))) {
      const r = path.join(rel, f), abs = path.join(dir, r);
      if (fs.statSync(abs).isDirectory()) { walk(dir, r); continue; }
      if (!TEXT.has(path.extname(f))) { fs.copyFileSync(abs, path.join(outDir, r)); continue; }
      let out = render(fs.readFileSync(abs, 'utf8'), vals, raw, r);
      if (f === 'index.html') {
        const desc = meta(out, 'description');
        if (!desc) throw new Error('src/index.html: cannot find <meta name="description" content="..."> inside <head>. Add it back.');
        const faq = [...out.matchAll(/<div\s+class="q"\s*>\s*<h3[^>]*>([\s\S]*?)<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>\s*<\/div>/g)].map(m => [unesc(squash(m[1])), unesc(squash(m[2]))]);
        if (!faq.length) console.warn('Warning: no FAQ items found in src/index.html, so FAQ structured data is left out.');
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].filter((_, i) => !cfg.closedDays.includes(i));
        const ld = [
          {
            '@context': 'https://schema.org', '@type': 'LocalBusiness', name: cfg.name, url: vals.DOMAIN + '/', image: vals.DOMAIN + '/og-image.jpg',
            description: unesc(desc), telephone: cfg.phone,
            address: { '@type': 'PostalAddress', streetAddress: cfg.street, addressLocality: cfg.city, addressCountry: cfg.countryCode },
            openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: days, opens: vals.OPEN_TIME, closes: `${pad(cfg.closeHour)}:00` }]
          },
          ...(faq.length ? [{
            '@context': 'https://schema.org', '@type': 'FAQPage',
            mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
          }] : [])];
        out = out.replace('<style>', `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n<style>`);
      }
      fs.writeFileSync(path.join(outDir, r), out);
    }
  })(path.join(ROOT, 'src'));

  // the Google script: string tokens are escaped for JS, numbers go in raw
  const jsVals = { ...vals, NAME: js(vals.NAME), OWNER_EMAIL: js(vals.OWNER_EMAIL), TZ: js(vals.TZ) };
  fs.mkdirSync(path.dirname(codeOut), { recursive: true });
  fs.writeFileSync(codeOut, render(fs.readFileSync(path.join(ROOT, 'apps-script/Code.template.gs'), 'utf8'), jsVals, new Set(Object.keys(jsVals)), 'Code.template.gs'));
  return { cfg, outDir, codeOut };
}

module.exports = { build, meta };
if (require.main === module) {
  try {
    const r = build({ dev: process.argv.includes('--dev') });
    console.log(`Built ${path.relative(ROOT, r.outDir)}/ and ${path.relative(ROOT, r.codeOut)}`);
  } catch (e) { console.error('Build failed: ' + e.message); process.exit(1); }
}