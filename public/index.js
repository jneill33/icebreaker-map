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
  chip.addEventListener('click', () => { input.value = s.text; input.removeAttribute('aria-invalid'); syncChips(); });
  chips.appendChild(chip);
}

input.addEventListener('input', syncChips);

// A red outline marks a required field until the host starts fixing it.
for (const id of ['question', 'options']) {
  const field = document.getElementById(id);
  field.addEventListener('input', () => field.removeAttribute('aria-invalid'));
}
// The example shows greyed out as a placeholder. It is never submitted unless the host picks it.
input.placeholder = SUGGESTIONS[0].text;
syncChips();

// Answer format and chart style are two small radio groups built from the same chips.
const choices = { format: 'text', chart: 'bar' };

function bindRadios(groupId, key, attr, onSelect) {
  const group = document.getElementById(groupId);
  group.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    choices[key] = chip.dataset[attr];
    for (const c of group.children) c.setAttribute('aria-checked', String(c === chip));
    if (onSelect) onSelect();
  });
}

bindRadios('formats', 'format', 'format', () => {
  document.getElementById('choice-settings').hidden = choices.format !== 'choice';
});
bindRadios('chart-types', 'chart', 'chart');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  const optionsField = document.getElementById('options');
  const problems = [];
  if (!input.value.trim()) problems.push([input, 'Please pick or write a question first.']);
  if (choices.format === 'choice') {
    const labels = new Set(optionsField.value.split('\n').map((o) => o.trim().toLowerCase()).filter(Boolean));
    if (labels.size < 2) problems.push([optionsField, 'Multiple choice needs at least two different options, one per line.']);
  }
  for (const field of [input, optionsField]) {
    field.setAttribute('aria-invalid', String(problems.some(([f]) => f === field)));
  }
  if (problems.length) {
    status.className = 'status error';
    status.textContent = problems[0][1];
    problems[0][0].focus();
    return;
  }
  button.disabled = true;
  status.className = 'status';
  status.textContent = 'Creating session...';
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: input.value,
        answerType: choices.format,
        options: optionsField.value.split('\n'),
        chart: choices.chart,
      }),
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
