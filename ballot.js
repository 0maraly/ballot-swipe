'use strict';
// Google Civic Information API lookup + normalizer.
// Zero dependencies (Node 18+ global fetch). The API key is read from the
// environment by the caller and never sent to the browser.

const BASE = 'https://www.googleapis.com/civicinfo/v2';

class CivicError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

async function civicGet(path, params, key, fetchImpl) {
  const f = fetchImpl || fetch;
  const qs = new URLSearchParams();
  Object.keys(params || {}).forEach(k => { if (params[k] != null && params[k] !== '') qs.set(k, params[k]); });
  qs.set('key', key);
  let res;
  try { res = await f(BASE + path + '?' + qs.toString(), { headers: { accept: 'application/json' } }); }
  catch (e) { throw new CivicError(502, 'network', 'Could not reach the Google Civic service.'); }
  let body = null;
  try { body = await res.json(); } catch (e) { /* non-JSON */ }
  if (!res.ok) {
    const msg = body && body.error && body.error.message || ('HTTP ' + res.status);
    const reason = body && body.error && body.error.errors && body.error.errors[0] && body.error.errors[0].reason || '';
    if (res.status === 400 || res.status === 404) throw new CivicError(404, 'no_data', msg);
    if (res.status === 429 || /rateLimit|quota/i.test(reason)) throw new CivicError(503, 'quota', 'The lookup service is busy. Try again soon.');
    if (res.status === 403 || res.status === 401) throw new CivicError(500, 'auth', 'Server key problem: ' + msg);
    throw new CivicError(502, 'upstream', msg);
  }
  return body || {};
}

// --- helpers ---------------------------------------------------------------

function clean(s) { return typeof s === 'string' ? s.trim() : ''; }

function partyShort(p) {
  p = clean(p);
  if (!p) return '';
  const l = p.toLowerCase();
  if (l.indexOf('democrat') === 0) return 'Democratic';
  if (l.indexOf('republican') === 0) return 'Republican';
  if (l.indexOf('libertarian') === 0) return 'Libertarian';
  if (l.indexOf('green') === 0) return 'Green';
  if (l.indexOf('nonpartisan') === 0 || l === 'non-partisan') return 'Nonpartisan';
  if (l.indexOf('independent') === 0) return 'Independent';
  return p;
}

function safeUrl(u) {
  u = clean(u);
  if (!/^https?:\/\//i.test(u)) return '';
  try { return new URL(u).toString(); } catch (e) { return ''; }
}

function normCandidate(c) {
  return {
    name: clean(c.name) || 'Unnamed candidate',
    party: partyShort(c.party),
    url: safeUrl(c.candidateUrl),
    photo: safeUrl(c.photoUrl),
    phone: clean(c.phone),
    email: clean(c.email),
    order: typeof c.orderOnBallot === 'number' ? c.orderOnBallot : null,
    channels: (c.channels || []).map(ch => ({ type: clean(ch.type), id: clean(ch.id) })).filter(ch => ch.type && ch.id)
  };
}

function addr(a) {
  if (!a) return '';
  const line = [a.locationName, a.line1, a.line2, a.line3].map(clean).filter(Boolean).join(', ');
  const city = [clean(a.city), clean(a.state)].filter(Boolean).join(', ');
  return [line, [city, clean(a.zip)].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
}

function normSite(s) {
  return {
    name: clean(s.address && s.address.locationName) || 'Location',
    address: addr(Object.assign({}, s.address, { locationName: '' })),
    hours: clean(s.pollingHours),
    notes: clean(s.notes),
    startDate: clean(s.startDate),
    endDate: clean(s.endDate)
  };
}

function levelLabel(c) {
  const lv = (c.level || [])[0] || '';
  const map = { country: 'Federal', administrativeArea1: 'State', administrativeArea2: 'County', locality: 'Local', regional: 'Regional', special: 'Special district', subLocality1: 'Local', subLocality2: 'Local' };
  return map[lv] || '';
}

// Contest -> card
function normContest(c, i) {
  const isRef = c.type === 'Referendum' || !!c.referendumTitle;
  const district = c.district && c.district.name ? clean(c.district.name) : '';
  const base = {
    id: 'c' + i,
    level: levelLabel(c),
    district: district,
    ballotPlacement: typeof c.ballotPlacement === 'number' ? c.ballotPlacement : null,
    type: clean(c.type),
    sources: (c.sources || []).map(s => ({ name: clean(s.name), official: !!s.official })).filter(s => s.name)
  };
  if (isRef) {
    return Object.assign(base, {
      kind: 'measure',
      title: clean(c.referendumTitle) || clean(c.office) || 'Ballot measure',
      subtitle: clean(c.referendumSubtitle),
      brief: clean(c.referendumBrief),
      text: clean(c.referendumText),
      pro: clean(c.referendumProStatement),
      con: clean(c.referendumConStatement),
      url: safeUrl(c.referendumUrl),
      threshold: clean(c.referendumPassageThreshold),
      effectOfAbstain: clean(c.referendumEffectOfAbstain),
      responses: (c.referendumBallotResponses || []).map(clean).filter(Boolean)
    });
  }
  const cands = (c.candidates || []).map(normCandidate);
  cands.sort((a, b) => (a.order == null ? 1e9 : a.order) - (b.order == null ? 1e9 : b.order));
  return Object.assign(base, {
    kind: 'race',
    office: clean(c.office) || 'Office',
    roles: c.roles || [],
    seats: Math.max(1, parseInt(c.numberElected, 10) || 1),
    votesAllowed: Math.max(1, parseInt(c.numberVotingFor, 10) || parseInt(c.numberElected, 10) || 1),
    candidates: cands
  });
}

function levelRank(c) {
  // Federal first, then state, then county/local, so the deck reads top to bottom like a ballot.
  return { Federal: 0, State: 1, Regional: 2, County: 3, Local: 4, 'Special district': 5, '': 6 }[c.level] != null
    ? { Federal: 0, State: 1, Regional: 2, County: 3, Local: 4, 'Special district': 5, '': 6 }[c.level] : 6;
}

function adminLinks(state) {
  const out = [];
  const s = (state && state[0]) || null;
  const eab = s && s.electionAdministrationBody;
  if (!eab) return { stateName: s && s.name || '', links: out };
  const L = (label, url) => { url = safeUrl(url); if (url) out.push({ label, url }); };
  L('State election information', eab.electionInfoUrl);
  L('Registration', eab.electionRegistrationUrl);
  L('Check registration', eab.electionRegistrationConfirmationUrl);
  L('Absentee and mail voting', eab.absenteeVotingInfoUrl);
  L('Find your polling place', eab.votingLocationFinderUrl);
  L('Ballot information', eab.ballotInfoUrl);
  L('Election rules', eab.electionRulesUrl);
  return { stateName: clean(s.name), links: out, body: clean(eab.name) };
}

function normalizeVoterInfo(raw) {
  raw = raw || {};
  const contests = (raw.contests || []).map(normContest);
  const withIdx = contests.map((c, i) => ({ c, i }));
  withIdx.sort((a, b) => {
    const r = levelRank(a.c) - levelRank(b.c);
    if (r) return r;
    const pa = a.c.ballotPlacement == null ? 1e9 : a.c.ballotPlacement;
    const pb = b.c.ballotPlacement == null ? 1e9 : b.c.ballotPlacement;
    return pa !== pb ? pa - pb : a.i - b.i;
  });
  const sorted = withIdx.map(x => x.c);
  const admin = adminLinks(raw.state);
  const ni = raw.normalizedInput || {};
  return {
    election: raw.election ? { id: String(raw.election.id || ''), name: clean(raw.election.name), date: clean(raw.election.electionDay) } : null,
    otherElections: (raw.otherElections || []).map(e => ({ id: String(e.id || ''), name: clean(e.name), date: clean(e.electionDay) })),
    // City/state only; the street line is never echoed back.
    place: [clean(ni.city), clean(ni.state)].filter(Boolean).join(', '),
    mailOnly: !!raw.mailOnly,
    measures: sorted.filter(c => c.kind === 'measure'),
    races: sorted.filter(c => c.kind === 'race'),
    polling: (raw.pollingLocations || []).map(normSite),
    early: (raw.earlyVoteSites || []).map(normSite),
    dropoff: (raw.dropOffLocations || []).map(normSite),
    stateName: admin.stateName,
    adminBody: admin.body || '',
    links: admin.links
  };
}

// Pick the election to show. Civic returns no contests when several elections share
// a day unless electionId is given, so we may need a second call.
function pickElection(list, now) {
  const today = (now || new Date()).toISOString().slice(0, 10);
  const real = (list || []).filter(e => String(e.id) !== '2000' && e.electionDay);
  real.sort((a, b) => a.electionDay < b.electionDay ? -1 : a.electionDay > b.electionDay ? 1 : 0);
  const upcoming = real.filter(e => e.electionDay >= today);
  return upcoming[0] || real[real.length - 1] || null;
}

async function lookup(address, opts) {
  const key = opts.key;
  if (!key) throw new CivicError(500, 'config', 'Server is missing GOOGLE_CIVIC_API_KEY.');
  const f = opts.fetch;
  const params = { address, officialOnly: opts.officialOnly ? 'true' : '' };
  if (opts.electionId) params.electionId = opts.electionId;

  let raw;
  try {
    raw = await civicGet('/voterinfo', params, key, f);
  } catch (e) {
    // With no live election for the address, voterinfo errors unless electionId is given.
    if (e.code === 'no_data' && !opts.electionId) {
      const el = await civicGet('/elections', {}, key, f).catch(() => ({}));
      const pick = pickElection(el.elections, opts.now);
      if (!pick) throw e;
      raw = await civicGet('/voterinfo', Object.assign({}, params, { electionId: pick.id }), key, f);
    } else throw e;
  }
  // Several elections that day and no contests: retry with the first election id.
  if (!(raw.contests || []).length && !opts.electionId) {
    const ids = [raw.election && raw.election.id].concat((raw.otherElections || []).map(e => e.id)).filter(Boolean);
    const real = ids.filter(id => String(id) !== '2000');
    if (real.length) {
      try { raw = await civicGet('/voterinfo', Object.assign({}, params, { electionId: real[0] }), key, f); } catch (e) { /* keep first */ }
    }
  }
  return normalizeVoterInfo(raw);
}

// --- request handling (framework-agnostic) -----------------------------------

const hits = new Map(); // ip -> [timestamps]; best-effort per warm instance
function rateLimited(ip, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}

function validateAddress(a) {
  a = clean(a);
  if (a.length < 8 || a.length > 200) return '';
  if (!/\d/.test(a)) return '';
  return a;
}

async function handle(input, opts) {
  // input: { address, electionId, ip }  -> { status, body }
  opts = opts || {};
  const address = validateAddress(input.address);
  if (!address) return { status: 400, body: { error: 'bad_address', message: 'Enter a full street address, including city and state or ZIP.' } };
  if (rateLimited(input.ip || 'x', opts.rateMax || 20, 60000)) return { status: 429, body: { error: 'rate', message: 'Too many lookups. Wait a minute and try again.' } };
  const electionId = /^\d{1,8}$/.test(clean(input.electionId)) ? clean(input.electionId) : '';
  try {
    const data = await lookup(address, { key: opts.key || process.env.GOOGLE_CIVIC_API_KEY, electionId, fetch: opts.fetch, now: opts.now });
    return { status: 200, body: data, noStore: true };
  } catch (e) {
    if (e instanceof CivicError) {
      const msg = e.code === 'no_data'
        ? 'No ballot data found for that address. This can mean the address was not recognized or the election is not covered yet.'
        : e.code === 'auth' || e.code === 'config' ? 'The lookup service is not configured correctly.' : e.message;
      return { status: e.status === 404 ? 404 : e.status, body: { error: e.code, message: msg } };
    }
    return { status: 500, body: { error: 'internal', message: 'Something went wrong.' } };
  }
}

module.exports = { lookup, handle, normalizeVoterInfo, pickElection, normContest, validateAddress, CivicError };
