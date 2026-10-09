'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, roundCoord } = require('../app');

let server, base, ctx;

test.before(async () => {
  ctx = createApp({
    publicUrl: 'https://example.test',
    geocode: async (q) => {
      if (q === 'boom') throw new Error('upstream down');
      return [{ label: `${q}, Testland`, lat: 30.2672, lng: -97.7431 }];
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

test('join stores only city-level coordinates and never leaks the key', async () => {
  const s = await newSession('Where from?');
  const res = await post(`/api/sessions/${s.id}/join`, {
    name: '  Ada  ', answer: 'London', lat: 51.50735, lng: -0.12776,
  });
  assert.equal(res.status, 201);
  const me = await res.json();
  assert.equal(me.lat, 51.5);
  assert.equal(me.lng, -0.1);

  const stored = [...ctx.sessions.get(s.id).participants.values()][0];
  assert.equal(stored.name, 'Ada');
  assert.equal(stored.lat, 51.5);

  const info = await (await fetch(`${base}/api/sessions/${s.id}`)).json();
  assert.equal(info.count, 1);
  assert.equal(JSON.stringify(info).includes(me.key), false);
});

test('join rejects missing names and bad coordinates', async () => {
  const s = await newSession();
  const url = `/api/sessions/${s.id}/join`;
  assert.equal((await post(url, { name: '', lat: 1, lng: 1 })).status, 400);
  assert.equal((await post(url, { name: 'x', lat: 91, lng: 1 })).status, 400);
  assert.equal((await post(url, { name: 'x', lat: '1', lng: 1 })).status, 400);
  assert.equal((await post(url, { name: 'x', lat: 1 })).status, 400);
});

test('unknown sessions return 404', async () => {
  assert.equal((await fetch(`${base}/api/sessions/nope`)).status, 404);
  assert.equal((await post('/api/sessions/nope/join', { name: 'x', lat: 1, lng: 1 })).status, 404);
});

test('participants can only be removed with their own key', async () => {
  const s = await newSession();
  const me = await (await post(`/api/sessions/${s.id}/join`, { name: 'Bo', lat: 1, lng: 1 })).json();
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
  await post(`/api/sessions/${s.id}/join`, { name: 'Cy', answer: 'Tea', lat: 35.68, lng: 139.69 });
  await readUntil('event: join');
  assert.ok(text.includes('"name":"Cy"'));
  assert.equal(text.includes('"key"'), false);
  await reader.cancel();
});

test('expired sessions are swept and their data is deleted', async () => {
  const s = await newSession();
  await post(`/api/sessions/${s.id}/join`, { name: 'Di', lat: 1, lng: 1 });
  ctx.sessions.get(s.id).expiresAt = Date.now() - 1;
  ctx.sweepExpired();
  assert.equal(ctx.sessions.has(s.id), false);
  assert.equal((await fetch(`${base}/api/sessions/${s.id}`)).status, 404);
});

test('referrer policy lets OSM tile servers see our origin', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
});

test('geocode returns city matches and validates input', async () => {
  const ok = await (await fetch(`${base}/api/geocode?q=Austin`)).json();
  assert.equal(ok.results[0].label, 'Austin, Testland');
  assert.equal((await fetch(`${base}/api/geocode?q=a`)).status, 400);
  assert.equal((await fetch(`${base}/api/geocode`)).status, 400);
  assert.equal((await fetch(`${base}/api/geocode?q=boom`)).status, 502);
});

test('a city-search location is rounded like any other', async () => {
  const s = await newSession();
  const me = await (await post(`/api/sessions/${s.id}/join`, { name: 'Ed', lat: 30.2672, lng: -97.7431 })).json();
  assert.equal(me.lat, 30.3);
  assert.equal(me.lng, -97.7);
});
