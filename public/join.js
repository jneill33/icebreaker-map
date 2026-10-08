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

  $('join').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.currentTarget.querySelector('button');
    const status = $('status');
    button.disabled = true;
    try {
      setStatus(status, 'Finding your location...');
      const pos = await geolocate();
      setStatus(status, 'Joining...');
      const r = await fetch(api('/join'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: $('name').value,
          answer: $('answer').value,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Could not join.');
      me = { id: body.id, key: body.key };
      localStorage.setItem(storeKey, JSON.stringify(me));
      showMap();
    } catch (err) {
      setStatus(status, err.message, 'error');
      button.disabled = false;
    }
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
