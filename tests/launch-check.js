// `npm run check:launch`: fails if the production build still contains placeholders or missing settings.
const fs = require('fs'), path = require('path');
const { build } = require('../build');
const { cfg, outDir } = build();
const problems = [], warns = [];
if (!cfg.endpoint.startsWith('https://script.google.com/')) problems.push('endpoint: paste your Apps Script web app URL into site.config.json');
if (/example\.com/.test(cfg.domain)) problems.push('domain: still example.com');
if (/example\.com/.test(cfg.email) || /example\.com/.test(cfg.ownerEmail)) problems.push('email / ownerEmail: still example.com');
if (/^0+$/.test(cfg.whatsapp)) problems.push('whatsapp: still the dummy number');
if (!cfg.gaId) warns.push('gaId is empty, so analytics is off (fine, but you will get no usage data)');
if (!fs.existsSync(path.join(__dirname, '..', 'src', 'og-image.jpg'))) warns.push('src/og-image.jpg is missing (1200x630 photo for link previews)');
for (const f of fs.readdirSync(outDir).filter(f => /\.(html|xml|txt)$/.test(f))) {
  const text = fs.readFileSync(path.join(outDir, f), 'utf8').replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script(?! type="application\/ld)[\s\S]*?<\/script>/g, '');
  const found = [...new Set(text.match(/\[[A-Za-z][^\]]{0,60}\]/g) || [])];
  if (found.length) problems.push(`${f}: placeholders left: ${found.slice(0, 8).join(' ')}${found.length > 8 ? ' ...' : ''}`);
}
warns.forEach(w => console.log('WARN  ' + w)); problems.forEach(p => console.log('FIX   ' + p));
console.log(problems.length ? `\n${problems.length} thing(s) to fix before launch.` : '\nReady to launch.');
process.exit(problems.length ? 1 : 0);
