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
  $('empty').hidden = people.length > 0;
  $('people-empty').hidden = people.length > 0;
  const list = $('people');
  list.replaceChildren();
  for (const p of [...people].reverse()) {
    const li = document.createElement('li');
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.style.setProperty('--pin', Avatar.color(p.id));
    avatar.textContent = Avatar.initial(p.name);
    const text = document.createElement('div');
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = p.name;
    text.appendChild(who);
    if (p.answer) {
      const said = document.createElement('div');
      said.className = 'said';
      said.textContent = p.answer;
      text.appendChild(said);
    }
    li.append(avatar, text);
    list.appendChild(li);
  }
}

function showEnded() {
  document.body.className = '';
  document.body.replaceChildren();
  const wrap = document.createElement('main');
  wrap.className = 'container narrow';
  wrap.style.paddingTop = '12vh';
  const card = document.createElement('div');
  card.className = 'card';
  card.style.textAlign = 'center';
  const h = document.createElement('h1');
  h.style.fontSize = '2rem';
  h.textContent = 'Session ended';
  const p = document.createElement('p');
  p.className = 'muted';
  p.style.margin = '10px 0 20px';
  p.textContent = 'All names, answers and locations for this session have been deleted.';
  const a = document.createElement('a');
  a.className = 'btn';
  a.href = '/';
  a.textContent = 'Start a new session';
  card.append(h, p, a);
  wrap.appendChild(card);
  document.body.appendChild(wrap);
}

async function init() {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
  if (!res.ok) return showEnded();
  const session = await res.json();

  $('question').textContent = session.question;
  $('join-url').textContent = session.joinUrl.replace(/^https?:\/\//, '');
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
      if (!confirm("End the session and delete everyone's pins and answers?")) return;
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
