'use strict';

// Shared live map used by the host and participant pages.
// Subscribes to the session's server-sent events and keeps one marker per person.
(function () {
  // Rounded coordinates make many people share the exact same point; spread pins a
  // little (deterministically per person) so they stay individually clickable.
  function jitter(id) {
    let h = 2166136261;
    for (const ch of id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    const a = (h >>> 0) / 4294967296;
    const b = (Math.imul(h, 2654435761) >>> 0) / 4294967296;
    return [(a - 0.5) * 0.04, (b - 0.5) * 0.04];
  }

  function describe(person) {
    const box = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = person.name;
    box.appendChild(name);
    if (person.answer) {
      const said = document.createElement('div');
      said.textContent = person.answer;
      box.appendChild(said);
    }
    return box;
  }

  window.LiveMap = function LiveMap(el, sessionId, { onChange, onEnd, getSelfId } = {}) {
    const map = L.map(el, { worldCopyJump: true }).setView([20, 0], 2);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const people = new Map();   // id -> person
    const markers = new Map();  // id -> L.circleMarker

    function fit() {
      const pts = [...markers.values()].map((m) => m.getLatLng());
      if (pts.length === 0) map.setView([20, 0], 2);
      else if (pts.length === 1) map.setView(pts[0], 8);
      else map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 10 });
    }

    function add(person) {
      remove(person.id);
      people.set(person.id, person);
      const [dLat, dLng] = jitter(person.id);
      const mine = getSelfId && getSelfId() === person.id;
      const marker = L.circleMarker([person.lat + dLat, person.lng + dLng], {
        radius: mine ? 11 : 9,
        color: '#ffffff',
        weight: 2,
        fillColor: mine ? '#e8590c' : '#5b5bf0',
        fillOpacity: 0.95,
      }).addTo(map);
      marker.bindTooltip(describe(person));
      marker.bindPopup(describe(person));
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
      JSON.parse(e.data).forEach(add);
      fit();
      notify();
    });
    source.addEventListener('join', (e) => { add(JSON.parse(e.data)); fit(); notify(); });
    source.addEventListener('leave', (e) => { remove(JSON.parse(e.data).id); fit(); notify(); });
    source.addEventListener('end', () => { source.close(); if (onEnd) onEnd(); });

    return { map, close: () => source.close() };
  };
})();
