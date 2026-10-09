'use strict';

// Fun, low-stakes questions. Location comes from ZIP codes, so none ask where people live.
const SUGGESTIONS = [
  { emoji: '🍕', text: "What's your favorite food?" },
  { emoji: '🥪', text: "What's for lunch today?" },
  { emoji: '🏖️', text: "What are your weekend plans?" },
  { emoji: '🐾', text: "What's your favorite animal?" },
  { emoji: '☕', text: 'Coffee, tea, or something else?' },
  { emoji: '🎬', text: 'What show or movie did you last love?' },
  { emoji: '🎵', text: "What song is stuck in your head?" },
  { emoji: '🍦', text: "What's your favorite ice cream flavor?" },
  { emoji: '🌅', text: 'Early bird or night owl?' },
  { emoji: '✈️', text: "What's your dream vacation spot?" },
  { emoji: '📚', text: 'What was the last great book you read?' },
  { emoji: '🎮', text: "What's your favorite way to unwind?" },
  { emoji: '🦸', text: 'Which superpower would you pick?' },
  { emoji: '🌮', text: "What's your go-to comfort meal?" },
  { emoji: '🎨', text: "What's a hobby you secretly love?" },
  { emoji: '🏆', text: "What's something you're proud of this year?" },
];

const form = document.getElementById('create');
const input = document.getElementById('question');
const chips = document.getElementById('chips');
const status = document.getElementById('status');

function syncChips() {
  for (const chip of chips.children) {
    chip.setAttribute('aria-checked', String(chip.dataset.text === input.value.trim()));
  }
}

for (const s of SUGGESTIONS) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.setAttribute('role', 'radio');
  chip.dataset.text = s.text;
  chip.textContent = `${s.emoji} ${s.text.replace(/[?]$/, '')}`;
  chip.addEventListener('click', () => { input.value = s.text; syncChips(); });
  chips.appendChild(chip);
}

input.addEventListener('input', syncChips);
input.value = SUGGESTIONS[0].text; // start with a good default so one click is enough
syncChips();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  status.className = 'status';
  status.textContent = 'Creating session...';
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: input.value }),
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
