'use strict';

const form = document.getElementById('create');
const status = document.getElementById('status');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  status.className = 'status';
  status.textContent = 'Creating session...';
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: document.getElementById('question').value }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Could not create session.');
    const session = await res.json();
    localStorage.setItem(`icebreaker.host.${session.id}`, session.hostToken);
    location.href = `/host.html?s=${encodeURIComponent(session.id)}`;
  } catch (err) {
    status.className = 'status error';
    status.textContent = err.message;
    button.disabled = false;
  }
});
