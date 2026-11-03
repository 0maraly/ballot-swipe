'use strict';
// Vercel serverless function: GET/POST /api/ballot
// The address is accepted only in a POST body, which keeps it out of URLs and access logs.
// It is never logged or stored here.
const { handle } = require('../lib/ballot');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // POST only: an address in a URL would end up in request logs.
  if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('Allow', 'POST'); return res.end(JSON.stringify({ error: 'method', message: 'Use the form on the site.' })); }
  const b = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const address = b.address, electionId = b.electionId;
  const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket && req.socket.remoteAddress || 'x').trim();
  const out = await handle({ address, electionId, ip });
  res.statusCode = out.status;
  res.end(JSON.stringify(out.body));
};

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return {}; } }
