'use strict';

// Live chart for multiple-choice sessions, shown as a tab on the host page. Counts come
// from the same event stream the map uses; the renderers below only draw, so a new chart
// type is one more function.
(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#14b8a6', '#84cc16', '#f97316', '#3b82f6', '#a855f7'];

  const svg = (tag, attrs = {}, text) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

  // rows: [{ label, count, color }]
  function drawBar(rows, total) {
    const rowH = 56, labelW = 190, barW = 560, pad = 12;
    const max = Math.max(1, ...rows.map((r) => r.count));
    const root = svg('svg', {
      viewBox: `0 0 ${labelW + barW + 120} ${rows.length * rowH + pad * 2}`,
      class: 'chart-svg',
    });
    rows.forEach((r, i) => {
      const y = pad + i * rowH;
      root.appendChild(svg('text', { x: labelW - 12, y: y + 30, 'text-anchor': 'end', class: 'chart-label' }, r.label));
      root.appendChild(svg('rect', { x: labelW, y: y + 8, width: barW, height: 32, rx: 8, class: 'chart-track' }));
      if (r.count > 0) {
        root.appendChild(svg('rect', {
          x: labelW, y: y + 8, width: Math.max(14, (r.count / max) * barW), height: 32, rx: 8, fill: r.color,
          class: 'chart-fill',
        }));
      }
      root.appendChild(svg('text', { x: labelW + barW + 14, y: y + 30, class: 'chart-value' }, `${r.count} · ${pct(r.count, total)}%`));
    });
    return root;
  }

  function drawPie(rows, total) {
    const size = 360, c = size / 2, radius = 160;
    const root = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'chart-svg chart-svg-pie' });
    if (total === 0) return root;
    const used = rows.filter((r) => r.count > 0);
    if (used.length === 1) {
      root.appendChild(svg('circle', { cx: c, cy: c, r: radius, fill: used[0].color }));
      return root;
    }
    let angle = -Math.PI / 2;
    for (const r of used) {
      const sweep = (r.count / total) * Math.PI * 2;
      const end = angle + sweep;
      const [x1, y1] = [c + radius * Math.cos(angle), c + radius * Math.sin(angle)];
      const [x2, y2] = [c + radius * Math.cos(end), c + radius * Math.sin(end)];
      root.appendChild(svg('path', {
        d: `M${c} ${c} L${x1} ${y1} A${radius} ${radius} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`,
        fill: r.color, stroke: '#fff', 'stroke-width': 3,
      }));
      angle = end;
    }
    return root;
  }

  const RENDERERS = { bar: drawBar, pie: drawPie };

  const el = (tag, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  };

  // Draws the live chart for `session` (the object from GET /api/sessions/:id) inside
  // `container`. Returns { close } to stop listening.
  window.LiveChart = function LiveChart(container, session, sessionId) {
    const draw = RENDERERS[session.chart] || drawBar;
    const isPie = session.chart === 'pie';
    const answers = new Map(); // participant id -> option

    const totalLine = el('p', 'muted chart-total');
    const box = el('div', 'chart-box');
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', 'Chart of responses');
    const legend = el('ul', 'legend');
    legend.hidden = !isPie;
    const empty = el('p', 'muted chart-empty');
    empty.textContent = 'Waiting for the first response...';
    container.replaceChildren(totalLine, box, legend, empty);

    function render() {
      const counts = new Map(session.options.map((o) => [o, 0]));
      for (const a of answers.values()) if (counts.has(a)) counts.set(a, counts.get(a) + 1);
      const rows = session.options.map((label, i) => ({ label, count: counts.get(label), color: COLORS[i % COLORS.length] }));
      const total = answers.size;
      totalLine.textContent = `${total} ${total === 1 ? 'response' : 'responses'}`;
      empty.hidden = total > 0;
      box.replaceChildren(draw(rows, total));
      if (isPie) {
        legend.replaceChildren(...rows.map((r) => {
          const li = el('li');
          const dot = el('i');
          dot.style.background = r.color;
          li.append(dot, `${r.label}: ${r.count} (${pct(r.count, total)}%)`);
          return li;
        }));
      }
    }

    const source = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/events`);
    source.addEventListener('snapshot', (e) => {
      answers.clear();
      for (const p of JSON.parse(e.data)) answers.set(p.id, p.answer);
      render();
    });
    source.addEventListener('join', (e) => { const p = JSON.parse(e.data); answers.set(p.id, p.answer); render(); });
    source.addEventListener('leave', (e) => { answers.delete(JSON.parse(e.data).id); render(); });
    source.addEventListener('end', () => source.close());
    render();

    return { close: () => source.close() };
  };
})();
