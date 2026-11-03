'use strict';
// Local dev server: node server.js   (needs GOOGLE_CIVIC_API_KEY in the environment)
// Add DEMO=1 to serve a built-in sample ballot with no key, for trying the UI.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handle, normalizeVoterInfo } = require('./lib/ballot');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/ballot') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 5000) req.destroy(); });
    req.on('end', async () => {
      let p = {};
      if (req.method === 'POST') { try { p = JSON.parse(body || '{}'); } catch (e) {} }
      else p = { address: url.searchParams.get('address'), electionId: url.searchParams.get('electionId') };
      let out;
      if (process.env.DEMO) {
        const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'test', 'fixture-voterinfo.json'), 'utf8'));
        out = { status: 200, body: normalizeVoterInfo(sample) };
      } else out = await handle({ address: p.address, electionId: p.electionId, ip: req.socket.remoteAddress });
      res.writeHead(out.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(out.body));
    });
    return;
  }
  let f = path.normalize(path.join(PUB, url.pathname === '/' ? 'index.html' : url.pathname));
  if (f.indexOf(PUB) !== 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log('http://localhost:' + PORT + (process.env.DEMO ? '  (DEMO data)' : '')));
