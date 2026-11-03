'use strict';
// Vercel serverless function: GET/POST /api/ballot
// Address is accepted in a POST body (preferred; keeps it out of URLs and access logs)
// or a GET query for quick testing. It is never logged or stored here.
const { handle } = require('../lib/ballot');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  let address = '', electionId = '';
  if (req.method === 'POST') {
    const b = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
    address = b.address; electionId = b.electionId;
  } else if (req.method === 'GET') {
    address = req.query && req.query.address; electionId = req.query && req.query.electionId;
  } else { res.statusCode = 405; return res.end(JSON.stringify({ error: 'method' })); }
  const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket && req.socket.remoteAddress || 'x').trim();
  const out = await handle({ address, electionId, ip });
  res.statusCode = out.status;
  res.end(JSON.stringify(out.body));
};

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return {}; } }
