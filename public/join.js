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

function showMap() {
  $('join-view').hidden = true;
  $('done-view').hidden = false;
  LiveMap($('map'), sessionId, {
    getSelfId: () => me && me.id,
    onChange: (people) => { $('count').textContent = people.length; },
    onEnd: () => showMessage('This session has ended', 'The host closed it and all locations were deleted.'),
  });
}

async function init() {
  const res = await fetch(api());
  if (!res.ok) return showMessage('Session not found', 'It may have ended or the link is wrong. Ask the host for a new QR code.');
  const session = await res.json();
  $('answer-label').textContent = session.question;

  try { me = JSON.parse(localStorage.getItem(storeKey)); } catch (_) { me = null; }
  if (me) return showMap();

  $('join').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.currentTarget.querySelector('button');
    const status = $('status');
    button.disabled = true;
    setStatus(status, 'Joining...');
    try {
      const r = await fetch(api('/join'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: $('name').value,
          answer: $('answer').value,
          zip: $('zip').value,
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
