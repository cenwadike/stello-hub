// Local dev server: builds in dev mode, serves dist/, rebuilds on change, and fakes the Google endpoint at /api/mock.
const http = require('http'), fs = require('fs'), path = require('path');
const { build } = require('./build');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

function start({ port = 8080, overrides = {}, quiet = false } = {}) {
  const run = () => build({ dev: true, overrides });
  run();
  const dist = path.join(__dirname, 'dist');
  const server = http.createServer((req, res) => {
    if (req.url === '/api/mock' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c);
      return req.on('end', () => {
        let d; try { d = JSON.parse(body); } catch { d = null; }
        if (!quiet) console.log('[mock endpoint] received:', d);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(d && d.name && d.phone ? { ok: true, id: 'DEV-' + Date.now().toString(36) } : { ok: false, error: 'Please enter your name and phone number.' }));
      });
    }
    let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    const file = path.join(dist, p);
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.statusCode = 404; return res.end(fs.readFileSync(path.join(dist, '404.html')));
    }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file));
  });
  return new Promise(r => server.listen(port, () => {
    if (!quiet) console.log(`Dev server: http://localhost:${server.address().port}  (form posts go to a local mock, not Google)`);
    r({ server, port: server.address().port, rebuild: run });
  }));
}
module.exports = { start };
if (require.main === module) {
  let started;
  try { started = start({ port: Number(process.env.PORT) || 8080 }); } catch (e) { console.error('Build failed: ' + e.message); process.exit(1); }
  started.then(({ rebuild }) => {
    let t; const again = () => { clearTimeout(t); t = setTimeout(() => { try { rebuild(); console.log('Rebuilt'); } catch (e) { console.error(e.message); } }, 150); };
    for (const d of ['src', 'apps-script']) fs.watch(path.join(__dirname, d), { recursive: true }, again);
    fs.watchFile(path.join(__dirname, 'site.config.json'), { interval: 500 }, again);
  });
}