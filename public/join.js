'use strict';

const sessionId = new URLSearchParams(location.search).get('s') || '';
const storeKey = `icebreaker.joined.${sessionId}`;
const api = (suffix = '') => `/api/sessions/${encodeURIComponent(sessionId)}${suffix}`;
const $ = (id) => document.getElementById(id);

let me = null; // { id, key, place }

function setStatus(el, text, kind = '') {
  el.className = `status ${kind}`.trim();
  el.textContent = text;
}

function showMessage(title, text) {
  const page = $('page');
  page.replaceChildren();
  const card = document.createElement('div');
  card.className = 'card';
  card.style.textAlign = 'center';
  const h = document.createElement('h1');
  h.style.fontSize = '1.8rem';
  h.textContent = title;
  const p = document.createElement('p');
  p.className = 'muted';
  p.style.margin = '10px 0 0';
  p.textContent = text;
  card.append(h, p);
  page.appendChild(card);
}

function confetti() {
  const box = $('confetti');
  const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6'];
  for (let i = 0; i < 36; i++) {
    const piece = document.createElement('i');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.6}s`;
    piece.style.animationDuration = `${2 + Math.random() * 1.4}s`;
    box.appendChild(piece);
  }
  setTimeout(() => box.replaceChildren(), 4500);
}

function showMap({ celebrate = false } = {}) {
  $('join-view').hidden = true;
  $('done-view').hidden = false;
  $('placed').textContent = me.place
    ? `Your pin is near ${me.place}. Tap any pin to see who it is.`
    : 'Tap any pin to see who it is.';
  if (celebrate) confetti();
  LiveMap($('map'), sessionId, {
    getSelfId: () => me && me.id,
    onEnd: () => showMessage('This session has ended', 'The host closed it and all pins were deleted. Thanks for joining!'),
  });
}

async function init() {
  const res = await fetch(api());
  if (!res.ok) return showMessage('Session not found', 'It may have ended or the link is wrong. Ask the host for a new QR code.');
  const session = await res.json();
  $('question').textContent = session.question;

  try { me = JSON.parse(localStorage.getItem(storeKey)); } catch (_) { me = null; }
  if (me) return showMap();

  $('join').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.currentTarget.querySelector('button[type="submit"]');
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
      me = { id: body.id, key: body.key, place: body.place };
      localStorage.setItem(storeKey, JSON.stringify(me));
      showMap({ celebrate: true });
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
