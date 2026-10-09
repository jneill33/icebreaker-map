'use strict';

const sessionId = new URLSearchParams(location.search).get('s') || '';
const storeKey = `icebreaker.joined.${sessionId}`;
const api = (suffix = '') => `/api/sessions/${encodeURIComponent(sessionId)}${suffix}`;
const $ = (id) => document.getElementById(id);

let me = null; // { id, key }

function setStatus(el, text, kind = '') {
  el.className = `status ${kind}`.trim();
  el.textContent = text;
}

function geolocate() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('This browser cannot share location.'));
    if (!window.isSecureContext) return reject(new Error('Location sharing needs a secure (https) connection.'));
    navigator.geolocation.getCurrentPosition(resolve, (err) => {
      const msg = {
        1: 'Location permission was denied. Allow it in your browser settings and try again.',
        2: 'Your location could not be determined. Try again.',
        3: 'Finding your location timed out. Try again.',
      }[err.code] || 'Could not get your location.';
      reject(new Error(msg));
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
  });
}

function showMap() {
  $('join-view').hidden = true;
  $('done-view').hidden = false;
  LiveMap($('map'), sessionId, {
    getSelfId: () => me && me.id,
    onChange: (people) => { $('count').textContent = people.length; },
    onEnd: () => showMessage('This session has ended', 'The host closed it and all locations were deleted.'),
  });
}

function showMessage(title, text) {
  const wrap = document.querySelector('.wrap');
  wrap.replaceChildren();
  const h = document.createElement('h1');
  h.textContent = title;
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = text;
  wrap.append(h, p);
}

async function init() {
  const res = await fetch(api());
  if (!res.ok) return showMessage('Session not found', 'It may have ended or the link is wrong. Ask the host for a new QR code.');
  const session = await res.json();
  $('question').textContent = session.question;
  $('answer-label').textContent = session.question;

  try { me = JSON.parse(localStorage.getItem(storeKey)); } catch (_) { me = null; }
  if (me) return showMap();

  const showManual = () => { $('manual').hidden = false; $('show-manual').hidden = true; };
  $('show-manual').addEventListener('click', showManual);

  async function joinWith(lat, lng, statusEl) {
    const buttons = $('join').querySelectorAll('button');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      setStatus(statusEl, 'Joining...');
      const r = await fetch(api('/join'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: $('name').value, answer: $('answer').value, lat, lng }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Could not join.');
      me = { id: body.id, key: body.key };
      localStorage.setItem(storeKey, JSON.stringify(me));
      showMap();
    } catch (err) {
      setStatus(statusEl, err.message, 'error');
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  // Primary path: device location. If it fails for any reason, offer the city picker.
  $('join').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('status');
    try {
      setStatus(status, 'Finding your location...');
      const pos = await geolocate();
      await joinWith(pos.coords.latitude, pos.coords.longitude, status);
    } catch (err) {
      setStatus(status, `${err.message} You can choose your city below instead.`, 'error');
      showManual();
      $('city').focus();
    }
  });

  // Fallback path: search for a city, then pick a result.
  async function searchCity() {
    const status = $('city-status');
    const list = $('city-results');
    list.replaceChildren();
    if (!$('name').reportValidity()) return;
    const q = $('city').value.trim();
    if (q.length < 2) return setStatus(status, 'Type at least 2 characters.', 'error');
    setStatus(status, 'Searching...');
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Search failed.');
      if (body.results.length === 0) return setStatus(status, 'No matches. Try a nearby larger city.', 'error');
      setStatus(status, '');
      for (const place of body.results) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = place.label;
        b.addEventListener('click', () => joinWith(place.lat, place.lng, status));
        li.appendChild(b);
        list.appendChild(li);
      }
    } catch (err) {
      setStatus(status, err.message, 'error');
    }
  }
  $('city-search').addEventListener('click', searchCity);
  $('city').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); searchCity(); }
  });
}

$('leave').addEventListener('click', async () => {
  if (!me) return;
  const r = await fetch(api(`/participants/${encodeURIComponent(me.id)}`), {
    method: 'DELETE',
    headers: { 'x-participant-key': me.key },
  });
  if (r.ok || r.status === 403) {
    localStorage.removeItem(storeKey);
    showMessage('You were removed', 'Your pin and answer are deleted. You can close this page.');
  } else {
    setStatus($('done-status'), 'Could not remove you. Try again.', 'error');
  }
});

init();
