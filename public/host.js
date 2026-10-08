'use strict';

const sessionId = new URLSearchParams(location.search).get('s') || '';
const tokenKey = `icebreaker.host.${sessionId}`;
const $ = (id) => document.getElementById(id);

function setStatus(text, kind = '') {
  $('status').className = `status ${kind}`.trim();
  $('status').textContent = text;
}

function renderPeople(people) {
  $('count').textContent = people.length;
  const list = $('people');
  list.replaceChildren();
  for (const p of [...people].reverse()) {
    const li = document.createElement('li');
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = p.name;
    li.appendChild(who);
    if (p.answer) {
      const said = document.createElement('div');
      said.className = 'said';
      said.textContent = p.answer;
      li.appendChild(said);
    }
    list.appendChild(li);
  }
}

function showEnded() {
  document.body.replaceChildren();
  const wrap = document.createElement('main');
  wrap.className = 'wrap';
  const h = document.createElement('h1');
  h.textContent = 'Session ended';
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = 'All locations for this session have been deleted.';
  const a = document.createElement('a');
  a.className = 'btn';
  a.href = '/';
  a.textContent = 'Start a new session';
  wrap.append(h, p, a);
  document.body.appendChild(wrap);
}

async function init() {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
  if (!res.ok) return showEnded();
  const session = await res.json();

  $('question').textContent = session.question;
  $('join-url').textContent = session.joinUrl;
  $('qr').src = `/api/sessions/${encodeURIComponent(sessionId)}/qr.svg`;

  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(session.joinUrl);
      setStatus('Link copied.', 'ok');
    } catch (_) {
      setStatus('Copy failed. Select the link above instead.', 'error');
    }
  });

  if (localStorage.getItem(tokenKey)) {
    $('end').hidden = false;
    $('end').addEventListener('click', async () => {
      if (!confirm('End the session and delete everyone\'s location?')) return;
      const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: { 'x-host-token': localStorage.getItem(tokenKey) },
      });
      if (r.ok) { localStorage.removeItem(tokenKey); showEnded(); }
      else setStatus('Could not end the session.', 'error');
    });
  }

  LiveMap($('map'), sessionId, { onChange: renderPeople, onEnd: showEnded });
}

init();
