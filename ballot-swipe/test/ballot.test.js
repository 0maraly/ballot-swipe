'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const B = require('../lib/ballot');

const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-voterinfo.json'), 'utf8'));
let n = 0;
async function t(name, fn) { try { await fn(); n++; console.log('ok  - ' + name); } catch (e) { console.error('FAIL - ' + name + '\n', e); process.exitCode = 1; } }

function mockFetch(routes) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const r = routes(u);
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  f.calls = calls; return f;
}

(async () => {
  await t('normalizes sample: counts, order, place', () => {
    const d = B.normalizeVoterInfo(fx);
    assert.strictEqual(d.measures.length, 2);
    assert.strictEqual(d.races.length, 3);
    assert.strictEqual(d.place, 'Springfield, XX');
    assert.deepStrictEqual(d.races.map(r => r.office), ['U.S. Senator', 'Mayor', 'School Committee']); // federal, then local by placement
    assert.strictEqual(d.measures[0].title, 'Question 1: Sample Transit Bond');
  });
  await t('candidates sorted by ballot order, party shortened, multi-seat parsed', () => {
    const d = B.normalizeVoterInfo(fx);
    const mayor = d.races.find(r => r.office === 'Mayor');
    assert.deepStrictEqual(mayor.candidates.map(c => c.name), ['Jordan Placeholder', 'Pat Sample']);
    const sen = d.races[0];
    assert.deepStrictEqual(sen.candidates.map(c => c.party), ['Democratic', 'Republican', 'Libertarian']);
    const sc = d.races.find(r => r.office === 'School Committee');
    assert.strictEqual(sc.votesAllowed, 2);
  });
  await t('rejects non-http(s) URLs (javascript: etc.)', () => {
    const d = B.normalizeVoterInfo(fx);
    assert(!d.links.some(l => /^javascript:/i.test(l.url)));
    assert.strictEqual(d.links.length, 3);
  });
  await t('does not echo street line', () => {
    const d = B.normalizeVoterInfo(fx);
    assert(!JSON.stringify(d).includes('1 Example St'));
  });
  await t('handles empty / missing fields', () => {
    const d = B.normalizeVoterInfo({});
    assert.deepStrictEqual([d.measures.length, d.races.length, d.polling.length, d.links.length], [0, 0, 0, 0]);
    assert.strictEqual(d.election, null);
  });
  await t('validateAddress', () => {
    assert.strictEqual(B.validateAddress('02114'), '');
    assert.strictEqual(B.validateAddress('Main Street, Boston MA'), '');
    assert.strictEqual(B.validateAddress('24 Beacon St, Boston, MA 02133'), '24 Beacon St, Boston, MA 02133');
  });
  await t('pickElection skips test id 2000 and past dates', () => {
    const p = B.pickElection([{ id: '2000', electionDay: '2030-01-01' }, { id: '1', electionDay: '2026-05-01' }, { id: '7', electionDay: '2026-11-03' }], new Date('2026-11-03T12:00:00Z'));
    assert.strictEqual(p.id, '7');
  });
  await t('lookup: happy path, key sent, address not in output', async () => {
    const f = mockFetch(() => ({ status: 200, body: fx }));
    const d = await B.lookup('1 Example St, Springfield XX 00000', { key: 'K', fetch: f });
    assert.strictEqual(d.races.length, 3);
    assert(f.calls[0].includes('key=K'));
  });
  await t('lookup: falls back to /elections when voterinfo 404s without electionId', async () => {
    const f = mockFetch(u => {
      if (u.pathname.endsWith('/elections')) return { status: 200, body: { elections: [{ id: '2000', electionDay: '2030-01-01' }, { id: '9999', electionDay: '2026-11-03' }] } };
      if (u.searchParams.get('electionId') === '9999') return { status: 200, body: fx };
      return { status: 404, body: { error: { message: 'Election unknown' } } };
    });
    const d = await B.lookup('1 Example St, Springfield XX', { key: 'K', fetch: f, now: new Date('2026-11-03T12:00:00Z') });
    assert.strictEqual(d.races.length, 3);
  });
  await t('lookup: retries with electionId when several elections and no contests', async () => {
    const empty = { election: { id: '5' }, otherElections: [{ id: '6' }], contests: [] };
    const f = mockFetch(u => u.searchParams.get('electionId') === '5' ? { status: 200, body: fx } : { status: 200, body: empty });
    const d = await B.lookup('1 Example St, Springfield XX', { key: 'K', fetch: f });
    assert.strictEqual(d.measures.length, 2);
  });
  await t('handle: bad address 400, quota 503, no_data 404, key never leaks', async () => {
    let r = await B.handle({ address: '123', ip: 'a' }, { key: 'K' });
    assert.strictEqual(r.status, 400);
    r = await B.handle({ address: '1 Example St, Springfield XX', ip: 'b' }, { key: 'SECRETKEY', fetch: mockFetch(() => ({ status: 429, body: {} })) });
    assert.strictEqual(r.status, 503);
    r = await B.handle({ address: '1 Example St, Springfield XX', ip: 'c' }, { key: 'SECRETKEY', fetch: mockFetch(() => ({ status: 404, body: { error: { message: 'x' } } })) });
    assert.strictEqual(r.status, 404);
    assert(!JSON.stringify(r).includes('SECRETKEY'));
  });
  await t('handle: rate limit', async () => {
    let last;
    for (let i = 0; i < 5; i++) last = await B.handle({ address: '1 Example St, Springfield XX', ip: 'rl' }, { rateMax: 3, key: 'K', fetch: mockFetch(() => ({ status: 200, body: fx })) });
    assert.strictEqual(last.status, 429);
  });
  console.log(n + ' passed');
})();
