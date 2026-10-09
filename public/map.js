'use strict';

// Shared helpers + live map used by the host and participant pages.
(function () {
  const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#14b8a6'];

  function hash(id) {
    let h = 2166136261;
    for (const ch of id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  window.Avatar = {
    color: (id) => COLORS[hash(id) % COLORS.length],
    initial: (name) => (Array.from((name || '').trim())[0] || '?').toUpperCase(),
  };

  // Rounded coordinates make many people share the exact same point; spread pins a
  // little (deterministically per person) so they stay individually clickable.
  function jitter(id) {
    const h = hash(id);
    const a = h / 4294967296;
    const b = (Math.imul(h, 2654435761) >>> 0) / 4294967296;
    return [(a - 0.5) * 0.04, (b - 0.5) * 0.04];
  }

  function describe(person) {
    const box = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'tip-name';
    name.textContent = person.name;
    box.appendChild(name);
    if (person.answer) {
      const said = document.createElement('div');
      said.className = 'tip-answer';
      said.textContent = person.answer;
      box.appendChild(said);
    }
    return box;
  }

  function pinElement(person, { mine, fresh }) {
    const el = document.createElement('div');
    el.className = `pin${mine ? ' pin-mine' : ''}${fresh ? ' pin-new' : ''}`;
    el.style.setProperty('--pin', window.Avatar.color(person.id));
    el.textContent = window.Avatar.initial(person.name);
    return el;
  }

  window.LiveMap = function LiveMap(el, sessionId, { onChange, onEnd, getSelfId } = {}) {
    const map = L.map(el, { worldCopyJump: true, zoomControl: true }).setView([39, -98], 4);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const people = new Map();   // id -> person
    const markers = new Map();  // id -> L.marker

    function fit() {
      const pts = [...markers.values()].map((m) => m.getLatLng());
      if (pts.length === 0) map.setView([39, -98], 4);
      else if (pts.length === 1) map.setView(pts[0], 8);
      else map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 10 });
    }

    function add(person, fresh = false) {
      remove(person.id);
      people.set(person.id, person);
      const [dLat, dLng] = jitter(person.id);
      const mine = Boolean(getSelfId && getSelfId() === person.id);
      const marker = L.marker([person.lat + dLat, person.lng + dLng], {
        icon: L.divIcon({
          className: 'pin-wrap',
          html: pinElement(person, { mine, fresh }),
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        }),
        keyboard: false,
        zIndexOffset: mine ? 1000 : 0,
      }).addTo(map);
      marker.bindTooltip(describe(person), { direction: 'top', offset: [0, -18] });
      marker.bindPopup(describe(person), { offset: [0, -14] });
      markers.set(person.id, marker);
    }

    function remove(id) {
      people.delete(id);
      const marker = markers.get(id);
      if (marker) { marker.remove(); markers.delete(id); }
    }

    const notify = () => onChange && onChange([...people.values()]);

    const source = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/events`);
    source.addEventListener('snapshot', (e) => {
      [...people.keys()].forEach(remove);
      JSON.parse(e.data).forEach((p) => add(p));
      fit();
      notify();
    });
    source.addEventListener('join', (e) => { add(JSON.parse(e.data), true); fit(); notify(); });
    source.addEventListener('leave', (e) => { remove(JSON.parse(e.data).id); fit(); notify(); });
    source.addEventListener('end', () => { source.close(); if (onEnd) onEnd(); });

    return { map, close: () => source.close() };
  };
})();
