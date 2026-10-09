'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, roundCoord } = require('../app');

const ZIPS = {
  '78701': { lat: 30.2672, lng: -97.7431, label: 'Austin, TX' },
  '10001': { lat: 40.7506, lng: -73.9972, label: 'New York, NY' },
};

let server, base, ctx;
let lookups = 0;

test.before(async () => {
  ctx = createApp({
    publicUrl: 'https://example.test',
    lookupZip: async (zip) => {
      lookups++;
      if (zip === '99999') throw new Error('upstream down');
      return ZIPS[zip] || null;
    },
  });
  await new Promise((resolve) => { server = ctx.app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.closeAllConnections();
  server.close();
  ctx.close();
});

const post = (url, body, headers = {}) => fetch(base + url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

async function newSession(question) {
  const res = await post('/api/sessions', { question });
  assert.equal(res.status, 201);
  return res.json();
}

const join = (id, body) => post(`/api/sessions/${id}/join`, body);

test('roundCoord rounds to 1 decimal and never returns -0', () => {
  assert.equal(roundCoord(40.7128), 40.7);
  assert.equal(roundCoord(-74.006), -74);
  assert.ok(Object.is(roundCoord(-0.04), 0));
});

test('create session returns a join URL based on PUBLIC_URL', async () => {
  const s = await newSession('Favorite snack?');
  assert.equal(s.question, 'Favorite snack?');
  assert.match(s.joinUrl, /^https:\/\/example\.test\/join\.html\?s=/);
  assert.ok(s.hostToken.length >= 16);
});

test('join looks up the ZIP, stores only rounded coordinates, and never stores the ZIP', async () => {
  const s = await newSession('Where from?');
  const res = await join(s.id, { name: '  Ada  ', answer: 'Austin', zip: '78701' });
  assert.equal(res.status, 201);
  const me = await res.json();
  assert.equal(me.place, 'Austin, TX');

  const stored = [...ctx.sessions.get(s.id).participants.values()][0];
  assert.equal(stored.name, 'Ada');
  assert.equal(stored.lat, 30.3);
  assert.equal(stored.lng, -97.7);
  assert.equal(JSON.stringify(stored).includes('78701'), false);

  const info = await (await fetch(`${base}/api/sessions/${s.id}`)).json();
  assert.equal(info.count, 1);
  assert.equal(JSON.stringify(info).includes(me.key), false);
});

test('join accepts ZIP+4 and ignores client-supplied coordinates', async () => {
  const s = await newSession();
  const res = await join(s.id, { name: 'Bo', zip: '10001-1234', lat: 0, lng: 0 });
  assert.equal(res.status, 201);
  const stored = [...ctx.sessions.get(s.id).participants.values()][0];
  assert.equal(stored.lat, 40.8);
  assert.equal(stored.lng, -74);
});

test('join rejects missing names and malformed ZIPs without calling the lookup', async () => {
  const s = await newSession();
  const before = lookups;
  assert.equal((await join(s.id, { name: '', zip: '78701' })).status, 400);
  assert.equal((await join(s.id, { name: 'x' })).status, 400);
  assert.equal((await join(s.id, { name: 'x', zip: '7870' })).status, 400);
  assert.equal((await join(s.id, { name: 'x', zip: 'abcde' })).status, 400);
  assert.equal((await join(s.id, { name: 'x', zip: '78701; DROP' })).status, 400);
  assert.equal(lookups, before);
});

test('unknown ZIP is a 400 and an upstream failure is a 502', async () => {
  const s = await newSession();
  const unknown = await join(s.id, { name: 'x', zip: '00000' });
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).error, /couldn't find/);
  assert.equal((await join(s.id, { name: 'x', zip: '99999' })).status, 502);
  assert.equal(ctx.sessions.get(s.id).participants.size, 0);
});

test('ZIP lookups are cached', async () => {
  const s = await newSession();
  await join(s.id, { name: 'a', zip: '10001' });
  const before = lookups;
  await join(s.id, { name: 'b', zip: '10001' });
  assert.equal(lookups, before);
});

test('unknown sessions return 404', async () => {
  assert.equal((await fetch(`${base}/api/sessions/nope`)).status, 404);
  assert.equal((await join('nope', { name: 'x', zip: '78701' })).status, 404);
});

test('participants can only be removed with their own key', async () => {
  const s = await newSession();
  const me = await (await join(s.id, { name: 'Bo', zip: '78701' })).json();
  const url = `${base}/api/sessions/${s.id}/participants/${me.id}`;
  assert.equal((await fetch(url, { method: 'DELETE', headers: { 'x-participant-key': 'wrong' } })).status, 403);
  assert.equal((await fetch(url, { method: 'DELETE', headers: { 'x-participant-key': me.key } })).status, 204);
  assert.equal(ctx.sessions.get(s.id).participants.size, 0);
});

test('only the host token can end a session', async () => {
  const s = await newSession();
  const url = `${base}/api/sessions/${s.id}`;
  assert.equal((await fetch(url, { method: 'DELETE' })).status, 403);
  assert.equal((await fetch(url, { method: 'DELETE', headers: { 'x-host-token': s.hostToken } })).status, 204);
  assert.equal((await fetch(url)).status, 404);
});

test('QR endpoint returns an SVG', async () => {
  const s = await newSession();
  const res = await fetch(`${base}/api/sessions/${s.id}/qr.svg`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await res.text(), /<svg/);
});

test('event stream sends a snapshot, then join events', async () => {
  const s = await newSession();
  const res = await fetch(`${base}/api/sessions/${s.id}/events`);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';

  const readUntil = async (needle) => {
    const deadline = Date.now() + 3000;
    while (!text.includes(needle)) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${needle}; got ${text}`);
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
  };

  await readUntil('event: snapshot');
  await join(s.id, { name: 'Cy', answer: 'Tea', zip: '10001' });
  await readUntil('event: join');
  assert.ok(text.includes('"name":"Cy"'));
  assert.equal(text.includes('"key"'), false);
  assert.equal(text.includes('10001'), false);
  await reader.cancel();
});

test('expired sessions are swept and their data is deleted', async () => {
  const s = await newSession();
  await join(s.id, { name: 'Di', zip: '78701' });
  ctx.sessions.get(s.id).expiresAt = Date.now() - 1;
  ctx.sweepExpired();
  assert.equal(ctx.sessions.has(s.id), false);
  assert.equal((await fetch(`${base}/api/sessions/${s.id}`)).status, 404);
});

test('referrer policy lets OSM tile servers see our origin', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
});
