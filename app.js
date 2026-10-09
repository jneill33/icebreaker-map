'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const QRCode = require('qrcode');

const MAX_PARTICIPANTS = 300;
const DEFAULT_QUESTION = "What's your favorite food?";

const clean = (value, max) =>
  String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

// City-level privacy: coordinates are rounded to 1 decimal degree (~11 km) on the
// server, so precise positions are never stored or sent to anyone. "+ 0" avoids -0.
const roundCoord = (v) => Math.round(v * 10) / 10 + 0;

const randomId = (bytes) => crypto.randomBytes(bytes).toString('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Tiny fixed-window limiter keyed by client IP.
function rateLimit(max, windowMs) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const n = (hits.get(req.ip) || 0) + 1;
    hits.set(req.ip, n);
    if (n > max) return res.status(429).json({ error: 'Too many requests, slow down.' });
    next();
  };
}

// ZIP -> coordinates via Zippopotam.us (free, no API key). Called from the server so
// participants' devices never contact a third party. Returns null for unknown ZIPs.
async function zippopotamLookup(zip) {
  const res = await fetch(`https://api.zippopotam.us/us/${zip}`, { signal: AbortSignal.timeout(5000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`zip lookup ${res.status}`);
  const place = (await res.json()).places?.[0];
  const lat = Number(place?.latitude);
  const lng = Number(place?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, label: `${place['place name']}, ${place['state abbreviation']}` };
}

function createApp({
  ttlMs = 12 * 60 * 60 * 1000,
  publicUrl = process.env.PUBLIC_URL,
  lookupZip = zippopotamLookup,
} = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  /** @type {Map<string, any>} */
  const sessions = new Map();

  const publicParticipant = (p) => ({
    id: p.id, name: p.name, answer: p.answer, lat: p.lat, lng: p.lng,
  });

  function send(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function broadcast(session, event, data) {
    for (const res of session.clients) send(res, event, data);
  }

  function endSession(session) {
    broadcast(session, 'end', {});
    for (const res of session.clients) res.end();
    session.clients.clear();
    sessions.delete(session.id);
  }

  function sweepExpired() {
    const now = Date.now();
    for (const s of sessions.values()) if (s.expiresAt <= now) endSession(s);
  }
  const sweep = setInterval(sweepExpired, 60 * 1000);
  sweep.unref();

  const heartbeat = setInterval(() => {
    for (const s of sessions.values()) for (const res of s.clients) res.write(': ping\n\n');
  }, 25 * 1000);
  heartbeat.unref();

  const baseUrl = (req) => (publicUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const joinUrl = (req, id) => `${baseUrl(req)}/join.html?s=${encodeURIComponent(id)}`;

  // --- Middleware ---
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': [
        "default-src 'self'",
        "img-src 'self' data: https://tile.openstreetmap.org",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      // OSM's tile servers reject requests with no Referer, so send our origin.
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      // The app never uses device location.
      'Permissions-Policy': 'geolocation=()',
    });
    next();
  });
  app.use(express.json({ limit: '2kb' }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/vendor/leaflet', express.static(path.join(__dirname, 'node_modules/leaflet/dist')));

  const getSession = (req, res, next) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found or expired.' });
    req.session = session;
    next();
  };

  // --- API ---
  app.post('/api/sessions', rateLimit(30, 60 * 60 * 1000), (req, res) => {
    const id = randomId(6);
    const session = {
      id,
      question: clean(req.body?.question, 140) || DEFAULT_QUESTION,
      hostToken: randomId(18),
      expiresAt: Date.now() + ttlMs,
      participants: new Map(),
      clients: new Set(),
    };
    sessions.set(id, session);
    res.status(201).json({
      id, hostToken: session.hostToken, question: session.question,
      expiresAt: session.expiresAt, joinUrl: joinUrl(req, id),
    });
  });

  app.get('/api/sessions/:id', getSession, (req, res) => {
    const s = req.session;
    res.json({
      id: s.id, question: s.question, count: s.participants.size,
      expiresAt: s.expiresAt, joinUrl: joinUrl(req, s.id),
    });
  });

  app.get('/api/sessions/:id/qr.svg', getSession, async (req, res) => {
    const svg = await QRCode.toString(joinUrl(req, req.session.id), {
      type: 'svg', margin: 1, errorCorrectionLevel: 'M',
    });
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  });

  // Rooms often share one venue IP (NAT), so keep this limit generous.
  const zipCache = new Map();
  app.post('/api/sessions/:id/join', rateLimit(300, 60 * 1000), getSession, async (req, res) => {
    const s = req.session;
    const { name, answer, zip } = req.body ?? {};
    const cleanName = clean(name, 40);
    if (!cleanName) return res.status(400).json({ error: 'Please enter a name.' });
    const zipMatch = clean(zip, 10).match(/^(\d{5})(?:-\d{4})?$/);
    if (!zipMatch) return res.status(400).json({ error: 'Enter a 5-digit US ZIP code.' });
    const code = zipMatch[1];

    if (!zipCache.has(code)) {
      try {
        zipCache.set(code, await lookupZip(code));
      } catch (_) {
        return res.status(502).json({ error: 'ZIP lookup is unavailable right now. Try again in a moment.' });
      }
      if (zipCache.size > 2000) zipCache.delete(zipCache.keys().next().value);
    }
    const place = zipCache.get(code);
    if (!place) return res.status(400).json({ error: "We couldn't find that ZIP code." });

    if (!sessions.has(s.id)) return res.status(404).json({ error: 'Session not found or expired.' });
    if (s.participants.size >= MAX_PARTICIPANTS) {
      return res.status(409).json({ error: 'This session is full.' });
    }
    // The ZIP itself is never stored; only the rounded, city-level coordinates are.
    const p = {
      id: randomId(6), key: randomId(12), name: cleanName, answer: clean(answer, 140),
      lat: roundCoord(place.lat), lng: roundCoord(place.lng),
    };
    s.participants.set(p.id, p);
    broadcast(s, 'join', publicParticipant(p));
    res.status(201).json({ id: p.id, key: p.key, place: place.label });
  });

  app.delete('/api/sessions/:id/participants/:pid', getSession, (req, res) => {
    const s = req.session;
    const p = s.participants.get(req.params.pid);
    if (!p || !safeEqual(req.get('x-participant-key'), p.key)) {
      return res.status(403).json({ error: 'Not allowed.' });
    }
    s.participants.delete(p.id);
    broadcast(s, 'leave', { id: p.id });
    res.status(204).end();
  });

  app.delete('/api/sessions/:id', getSession, (req, res) => {
    if (!safeEqual(req.get('x-host-token'), req.session.hostToken)) {
      return res.status(403).json({ error: 'Not allowed.' });
    }
    endSession(req.session);
    res.status(204).end();
  });

  app.get('/api/sessions/:id/events', getSession, (req, res) => {
    const s = req.session;
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    send(res, 'snapshot', [...s.participants.values()].map(publicParticipant));
    s.clients.add(res);
    req.on('close', () => s.clients.delete(res));
  });

  // --- Errors ---
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Server error.' : 'Bad request.' });
  });

  return { app, sessions, sweepExpired, close: () => { clearInterval(sweep); clearInterval(heartbeat); } };
}

module.exports = { createApp, roundCoord };
