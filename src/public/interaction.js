// Vista de interaccion: tiempos de respuesta del equipo con clientes y proveedores.
// Usa $, num, kpi, tip, fmt, applyFilter (app.js) y showView (people.js).
const PERIODS = [[1, '24 h'], [7, '7 días'], [30, '30 días']];
let days = 7;
let report = null;

// Duracion legible a partir de segundos; trunca a minutos completos (4 min 50 s -> 4 min),
// igual que los rangos del semaforo
function dur(secs) {
  if (secs == null) return '–';
  const m = Math.floor(secs / 60);
  if (m < 1) return '< 1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function table(target, headers, rows) {
  const head = el('tr');
  for (const [label, numeric] of headers) head.append(el('th', label, numeric ? 'num' : ''));
  target.replaceChildren(head, ...rows);
}

const cell = (text, cls) => el('td', text, cls);

function meterCell(on, total) {
  const td = el('td', null, 'num');
  const m = el('span', null, 'meter');
  const fill = el('i');
  fill.style.width = `${pct(on, total)}%`;
  m.append(fill);
  td.append(m, `${pct(on, total)}%`);
  return td;
}

async function loadInteraction() {
  $('interNote').textContent = 'Calculando…';
  const res = await fetch(`/api/interaction?days=${days}&threshold=${$('threshold').value}`);
  if (!res.ok) {
    $('interNote').textContent = 'No se pudo calcular';
    return;
  }
  report = await res.json();
  if (report) renderInteraction();
}

function renderInterControls() {
  $('daysTabs').replaceChildren(
    ...PERIODS.map(([d, label]) => {
      const b = el('button', label);
      b.classList.toggle('active', d === days);
      b.addEventListener('click', () => {
        days = d;
        loadInteraction();
      });
      return b;
    }),
  );
  const since = report.dataSince ? new Date(report.dataSince * 1000).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '–';
  $('interNote').textContent = `Horario: ${report.workHours} · datos con remitente desde el ${since} · ${report.teamSize} personas en el equipo`;
}

// Tarjeta de indicador con comparacion contra el periodo anterior.
// better: 'down' si bajar es bueno, 'up' si subir es bueno, null si es neutral
function kpiDelta(label, value, sub, cur, prev, better, fmtDiff) {
  const card = kpi(label, value, sub);
  const line = el('div', null, 'delta');
  if (prev == null || cur == null) {
    line.textContent = 'Sin datos completos del periodo anterior para comparar';
  } else {
    const diff = cur - prev;
    const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '=';
    if (better && diff) line.classList.add((diff < 0) === (better === 'down') ? 'good' : 'bad');
    line.append(el('b', arrow), diff ? `${fmtDiff(Math.abs(diff))} vs periodo anterior` : 'Igual que el periodo anterior');
  }
  card.append(line);
  return card;
}

function renderInterKpis() {
  const t = report.totals;
  const p = t.prev;
  const has = report.prevComplete;
  const thr = dur(report.threshold * 60);
  const mins = (s) => dur(s).replace('< 1 min', 'menos de 1 min');
  $('interKpis').replaceChildren(
    kpiDelta('Respuesta mediana', dur(t.median), `promedio ${dur(t.avg)}`, t.median, has ? p.median : null, 'down', mins),
    kpiDelta(`Respondidas en ${thr} o menos`, `${pct(t.onTime, t.answered)}%`, `${num(t.onTime)} de ${num(t.answered)} respondidas`,
      pct(t.onTime, t.answered), has ? pct(p.onTime, p.answered) : null, 'up', (d) => `${d} puntos`),
    kpiDelta('Sin respuesta', num(t.pending), `más de ${thr} esperando`, t.pending, has ? p.pending : null, 'down', (d) => num(d)),
    kpiDelta('Solicitudes', num(t.requests), `${num(t.byKind.Cliente.requests)} de clientes · ${num(t.byKind.Proveedor.requests)} de proveedores`,
      t.requests, has ? p.requests : null, null, (d) => num(d)),
  );
}

// Mini grafica de linea con la mediana diaria; la linea punteada marca 10 min
function spark(values, w = 96, h = 26) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  const max = Math.min(3600, Math.max(900, ...values.filter((v) => v != null)));
  const x = (i) => 2 + (i / (values.length - 1)) * (w - 4);
  const y = (v) => h - 2 - (Math.min(v, max) / max) * (h - 4);
  const ref = document.createElementNS(ns, 'line');
  Object.entries({ x1: 0, x2: w, y1: y(600), y2: y(600), stroke: 'var(--red)', 'stroke-dasharray': '2 3', 'stroke-width': 1, opacity: 0.7 })
    .forEach(([k, v]) => ref.setAttribute(k, v));
  svg.append(ref);
  let d = '';
  values.forEach((v, i) => {
    if (v == null) return;
    d += `${d && values[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  const path = document.createElementNS(ns, 'path');
  Object.entries({ d, fill: 'none', stroke: 'var(--seq)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })
    .forEach(([k, v]) => path.setAttribute(k, v));
  svg.append(path);
  // Dias sueltos (sin vecinos con dato) como punto, para que no se pierdan
  values.forEach((v, i) => {
    if (v == null || values[i - 1] != null || values[i + 1] != null) return;
    const dot = document.createElementNS(ns, 'circle');
    Object.entries({ cx: x(i), cy: y(v), r: 1.5, fill: 'var(--seq)' }).forEach(([k, val]) => dot.setAttribute(k, val));
    svg.append(dot);
  });
  const lastIdx = values.findLastIndex((v) => v != null);
  if (lastIdx >= 0) {
    const dot = document.createElementNS(ns, 'circle');
    Object.entries({ cx: x(lastIdx), cy: y(values[lastIdx]), r: 3, fill: 'var(--seq)' }).forEach(([k, v]) => dot.setAttribute(k, v));
    svg.append(dot);
  }
  return svg;
}

const LEVELS = { 3: ['Alta', 'red'], 2: ['Media', 'yellow'] };
// Empeoro: la mediana subio al menos 3 min y 50% contra el periodo anterior
const worsened = (cur, prev) => cur != null && prev != null && cur - prev >= 180 && cur >= prev * 1.5;
const improved = (cur, prev) => cur != null && prev != null && prev - cur >= 120 && cur <= prev * 0.67;

function attItem(level, name, reasons, values, onClick) {
  const [label, color] = LEVELS[level];
  const row = el('div', null, 'att');
  const lvl = el('span', label, 'lvl');
  lvl.style.setProperty('--c', `var(--${color})`);
  row.append(lvl, el('span', name, 'att-name'), spark(values), el('span', reasons.join(' · '), 'att-why'));
  row.addEventListener('click', onClick);
  return row;
}

function renderInterAttention() {
  const cmp = report.prevComplete;
  const worse = (cur, prev) => cmp && worsened(cur, prev);
  const better = (cur, prev) => cmp && improved(cur, prev);
  // Grupos: pendientes ahora, mediana en rojo, muchas respuestas en rojo o empeoro
  const groups = report.byGroup
    .map((g) => {
      let score = 0;
      const why = [];
      if (g.pending) { score += 2; why.push(`${g.pending} sin respuesta ahora`); }
      if (g.answered >= 5 && g.median >= 600) { score += 2; why.push(`mediana ${dur(g.median)}`); }
      if (g.answered >= 5 && g.slow / g.answered >= 0.4) { score += 1; why.push(`${pct(g.slow, g.answered)}% en rojo`); }
      if (g.answered >= 5 && worse(g.median, g.prev.median)) { score += 2; why.push(`subió de ${dur(g.prev.median)} a ${dur(g.median)}`); }
      return { g, score, why };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score || b.g.pending - a.g.pending || (b.g.median ?? 0) - (a.g.median ?? 0))
    .slice(0, 8);
  $('attGroups').replaceChildren(
    ...(groups.length
      ? groups.map(({ g, score, why }) =>
          attItem(score >= 4 ? 3 : 2, g.name, [`${g.client} · ${num(g.requests)} solicitudes`, ...why], g.daily, () => {
            showView('groups');
            applyFilter('Todos', 'Todos', g.name);
            document.querySelector(`details[data-id="${CSS.escape(g.id)}"]`)?.setAttribute('open', '');
          }))
      : [el('div', 'Ningún grupo requiere atención en este periodo.', 'att-none')]),
  );
  const goodG = report.byGroup.filter((g) => g.answered >= 5 && better(g.median, g.prev.median));
  $('goodGroups').textContent = goodG.length
    ? `Mejoraron: ${goodG.slice(0, 4).map((g) => `${g.name} (${dur(g.prev.median)} → ${dur(g.median)})`).join(', ')}`
    : '';

  // Equipo: mediana en rojo, muchas respuestas en rojo o empeoro
  const team = report.byMember
    .filter((p) => p.responses >= 5)
    .map((p) => {
      let score = 0;
      const why = [];
      if (p.median >= 600) { score += 2; why.push(`mediana ${dur(p.median)}`); }
      else if (p.median >= 300) { score += 1; why.push(`mediana ${dur(p.median)}`); }
      if (p.slow / p.responses >= 0.4) { score += 1; why.push(`${pct(p.slow, p.responses)}% en rojo`); }
      if (worse(p.median, p.prev.median)) { score += 2; why.push(`subió de ${dur(p.prev.median)} a ${dur(p.median)}`); }
      return { p, score, why };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score || b.p.median - a.p.median)
    .slice(0, 8);
  $('attTeam').replaceChildren(
    ...(team.length
      ? team.map(({ p, score, why }) =>
          attItem(score >= 3 ? 3 : 2, p.name, [`${num(p.responses)} respuestas`, ...why], p.daily, () => {
            const d = document.querySelector(`details.person[data-board="answers"][data-jid="${CSS.escape(p.jid)}"]`);
            if (!d) return;
            d.open = true;
            d.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }))
      : [el('div', 'Nadie del equipo requiere atención en este periodo.', 'att-none')]),
  );
  const goodT = report.byMember.filter((p) => p.responses >= 5 && better(p.median, p.prev.median));
  $('goodTeam').textContent = goodT.length
    ? `Mejoraron: ${goodT.slice(0, 4).map((p) => `${p.name} (${dur(p.prev.median)} → ${dur(p.median)})`).join(', ')}`
    : '';
  if (!cmp) {
    $('goodGroups').textContent = 'La comparación contra el periodo anterior aparece cuando hay datos de todo ese periodo; mientras tanto usa la línea de cada fila.';
  }
}

// --- Graficas de tendencia (SVG) ---
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, text) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}
const dayLabel = (day) => {
  const [, m, d] = day.split('-');
  return `${Number(d)}/${Number(m)}`;
};
const dayLong = (day) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

// Marco comun: ancho fijo en viewBox, eje x con fechas y zona de hover por dia
function frame(series, height, yMax, yTicks, yFmt) {
  const W = 560, H = height, L = 44, R = 8, T = 8, B = 22;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const bw = (W - L - R) / Math.max(1, series.length);
  const x = (i) => L + bw * i + bw / 2;
  const y = (v) => T + (1 - Math.min(v, yMax) / yMax) * (H - T - B);
  for (const t of yTicks) {
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), class: 'grid' }));
    svg.append(svgEl('text', { x: L - 6, y: y(t) + 4, 'text-anchor': 'end' }, yFmt(t)));
  }
  const every = Math.ceil(series.length / 8);
  series.forEach((d, i) => {
    if (i % every === 0 || i === series.length - 1) {
      svg.append(svgEl('text', { x: x(i), y: H - 6, 'text-anchor': 'middle' }, dayLabel(d.day)));
    }
  });
  return { svg, x, y, bw, L, R, T, B, W, H };
}

function hitAreas(f, series, lines) {
  series.forEach((d, i) => {
    const r = svgEl('rect', { x: f.L + f.bw * i, y: f.T, width: f.bw, height: f.H - f.T - f.B, class: 'hit' });
    tip(r, () => lines(d));
    f.svg.append(r);
  });
}

function renderTrendMedian() {
  const series = report.trend;
  const vals = series.map((d) => (d.median == null ? null : d.median / 60));
  const top = Math.max(15, Math.ceil(Math.max(0, ...vals.filter((v) => v != null)) / 5) * 5);
  const ticks = [0, 5, 10, ...(top > 10 ? [top] : [])];
  const f = frame(series, 220, top, ticks, (t) => `${t} min`);
  // Bandas del semaforo
  for (const [from, to, c] of [[0, 5, 'green'], [5, 10, 'yellow'], [10, top, 'red']]) {
    f.svg.insertBefore(svgEl('rect', { x: f.L, width: f.W - f.L - f.R, y: f.y(to), height: f.y(from) - f.y(to), fill: `var(--${c})`, opacity: 0.08 }), f.svg.firstChild);
  }
  let d = '';
  vals.forEach((v, i) => {
    if (v == null) return;
    d += `${d && vals[i - 1] != null ? 'L' : 'M'}${f.x(i).toFixed(1)},${f.y(v).toFixed(1)}`;
  });
  f.svg.append(svgEl('path', { d, fill: 'none', stroke: 'var(--seq)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  vals.forEach((v, i) => {
    if (v != null) f.svg.append(svgEl('circle', { cx: f.x(i), cy: f.y(v), r: 4, fill: 'var(--seq)', stroke: 'var(--card)', 'stroke-width': 2 }));
  });
  hitAreas(f, series, (d) => [
    dayLong(d.day),
    `Mediana: ${dur(d.median)}`,
    `${num(d.requests)} solicitudes · ${pct(d.onTime, d.answered)}% en ${dur(report.threshold * 60)} o menos`,
  ]);
  $('trendMedian').replaceChildren(f.svg);
}

const VOLUME_PARTS = [
  ['fast', 'Menos de 5 min', 'var(--green)'],
  ['mid', '5 a 9 min', 'var(--yellow)'],
  ['slow', '10 min o más', 'var(--red)'],
  ['unanswered', 'Sin respuesta', 'var(--muted)'],
];

function renderTrendVolume() {
  const series = report.trend;
  const max = Math.max(10, ...series.map((d) => d.requests));
  const step = max > 200 ? 100 : max > 100 ? 50 : max > 40 ? 20 : 10;
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const f = frame(series, 220, top, ticks, (t) => num(t));
  const barW = Math.min(28, f.bw * 0.7);
  series.forEach((d, i) => {
    let base = 0;
    for (const [key, , color] of VOLUME_PARTS) {
      const v = d[key];
      if (!v) continue;
      const y1 = f.y(base + v);
      const h = f.y(base) - y1;
      // 2 px de separacion entre segmentos
      f.svg.append(svgEl('rect', { x: f.x(i) - barW / 2, y: y1, width: barW, height: Math.max(0, h - (base ? 2 : 0)), fill: color, rx: 2 }));
      base += v;
    }
  });
  hitAreas(f, series, (d) => [
    dayLong(d.day),
    `${num(d.requests)} solicitudes`,
    ...VOLUME_PARTS.map(([key, label]) => `${label}: ${num(d[key])}`),
  ]);
  $('trendVolume').replaceChildren(f.svg);
  $('trendLegend').replaceChildren(
    ...VOLUME_PARTS.map(([, label, color]) => {
      const sp = el('span', label);
      sp.style.setProperty('--c', color);
      return sp;
    }),
  );
}

function renderInterPending() {
  const list = report.pending;
  $('pendingTitle').textContent = `Sin respuesta (${list.length})`;
  if (!list.length) {
    $('pendingList').replaceChildren(el('p', 'No hay mensajes pendientes en este periodo.', 'muted'));
    return;
  }
  $('pendingList').replaceChildren(
    ...list.map((p) => {
      const div = el('div', null, 'pend');
      const top = el('div', null, 'top');
      const left = el('span');
      left.append(el('strong', p.group), el('span', p.client, 'chip'), el('span', p.kind, 'chip'));
      top.append(left, el('span', `esperando ${dur(p.wait)}`, 'warn'));
      const who = el('div', `${p.requester} · ${fmt(p.start)}${p.count > 1 ? ` · ${p.count} mensajes` : ''}`, 'muted');
      who.style.fontSize = '.8rem';
      div.append(top, who, el('div', p.text, 'txt'));
      div.addEventListener('click', () => {
        showView('groups');
        applyFilter('Todos', 'Todos', p.group);
        document.querySelector(`details[data-id="${CSS.escape(p.groupId)}"]`)?.setAttribute('open', '');
      });
      return div;
    }),
  );
}

function renderInterClients() {
  const thr = dur(report.threshold * 60);
  table(
    $('clientTable'),
    [['Cliente'], ['Tipo de grupo'], ['Grupos', 1], ['Solicitudes', 1], ['Mediana', 1], ['Promedio', 1], [`≤ ${thr}`, 1], ['Sin respuesta', 1]],
    report.byClient.map((c) => {
      const tr = el('tr');
      tr.append(
        cell(c.client),
        cell(c.type),
        cell(num(c.groups), 'num'),
        cell(num(c.requests), 'num'),
        cell(dur(c.median), 'num'),
        cell(dur(c.avg), 'num'),
        meterCell(c.onTime, c.answered),
        cell(num(c.pending), c.pending ? 'num warn' : 'num'),
      );
      return tr;
    }),
  );
}

// Semaforo segun el tiempo mediano de respuesta (en segundos)
const LIGHTS = [
  { key: 'green', label: 'Verde', range: 'Menos de 5 min', test: (s) => s < 300 },
  { key: 'yellow', label: 'Amarillo', range: 'De 5 a 9 min', test: (s) => s < 600 },
  { key: 'red', label: 'Rojo', range: '10 min o más', test: () => true },
];
const lightOf = (p) => (p.median == null ? null : LIGHTS.find((l) => l.test(p.median)));

function lamp(light) {
  const span = el('span', null, 'lamp');
  span.style.setProperty('--c', `var(--${light.key})`);
  span.title = `${light.label}: ${light.range.toLowerCase()}`;
  return span;
}

// Desplegable con los grupos donde la persona respondio en rojo y cada tiempo de respuesta
function redList(p) {
  const box = el('div', null, 'reds');
  if (!p.redGroups.length) {
    box.append(el('div', 'Sin respuestas en rojo en este periodo.', 'muted'));
    return box;
  }
  box.append(el('div', `${num(p.slow)} ${p.slow === 1 ? 'respuesta' : 'respuestas'} en rojo en ${num(p.redGroups.length)} ${p.redGroups.length === 1 ? 'grupo' : 'grupos'}`, 'muted'));
  for (const g of p.redGroups) {
    const rg = el('div', null, 'rg');
    const head = el('div', null, 'rg-head');
    const name = el('span', g.group);
    name.append(el('span', g.client, 'chip'));
    head.append(name, el('span', `${g.count} · máx. ${dur(g.max)}`));
    head.title = 'Abrir el grupo';
    head.addEventListener('click', () => {
      showView('groups');
      applyFilter('Todos', 'Todos', g.group);
      document.querySelector(`details[data-id="${CSS.escape(g.groupId)}"]`)?.setAttribute('open', '');
    });
    rg.append(head);
    for (const c of g.items) {
      const row = el('div', null, 'case');
      row.append(
        el('span', `${fmt(c.start)} · ${c.requester}`),
        el('span', dur(c.wait), 'w'),
        el('span', c.text, 't'),
      );
      row.title = `Recibido ${fmt(c.start)} · respondido ${fmt(c.answeredAt)}\n${c.text}`;
      rg.append(row);
    }
    box.append(rg);
  }
  return box;
}

// Tablero de semaforo en tres columnas (verde, amarillo, rojo).
// board: nombre del tablero; people: personas con median, fast, mid, slow;
// light: color de cada persona; summary: texto bajo la barra; detail: desplegable de cada persona
function lightBoard(target, board, people, { light = lightOf, summary, detail }) {
  // Conserva abiertas las personas que estaban desplegadas
  const open = new Set([...target.querySelectorAll('details.person[open]')].map((d) => d.dataset.jid));
  target.replaceChildren(
    ...LIGHTS.map((l) => {
      const list = people.filter((p) => light(p) === l).sort((a, b) => (a.median ?? Infinity) - (b.median ?? Infinity));
      const box = el('div', null, 'light');
      box.style.setProperty('--c', `var(--${l.key})`);
      const h = el('h3');
      const title = el('span');
      title.append(lamp(l), l.label);
      h.append(title, el('span', `${list.length}`, 'muted'));
      box.append(h, el('div', l.range, 'range'));
      if (!list.length) box.append(el('div', 'Nadie en este rango', 'empty'));
      for (const p of list) {
        const row = el('summary');
        const split = el('div', null, 'split');
        for (const [k, n] of [['green', p.fast], ['yellow', p.mid], ['red', p.slow]]) {
          const seg = el('i');
          seg.style.flex = String(n);
          seg.style.background = `var(--${k})`;
          split.append(seg);
        }
        row.append(el('span', p.name), el('span', p.median == null ? 'sin respuesta' : dur(p.median), 'med'), split, el('span', summary(p), 'sub'));
        tip(split, () => [p.name, `${num(p.fast)} en menos de 5 min`, `${num(p.mid)} de 5 a 9 min`, `${num(p.slow)} en 10 min o más`]);
        const d = el('details', null, 'person');
        d.dataset.jid = p.jid;
        d.dataset.board = board;
        d.open = open.has(p.jid);
        d.append(row, detail(p));
        box.append(d);
      }
      return box;
    }),
  );
}

const colorMix = (p) => `${pct(p.fast, p.responses)}% verde · ${pct(p.mid, p.responses)}% amarillo · ${pct(p.slow, p.responses)}% rojo`;

function renderInterLights() {
  lightBoard($('lights'), 'answers', report.byMember.filter((p) => p.responses), {
    summary: (p) => `${num(p.responses)} respuestas · ${colorMix(p)}`,
    detail: redList,
  });
}

// Abre un grupo en la vista Grupos
function goToGroup(name, id) {
  showView('groups');
  applyFilter('Todos', 'Todos', name);
  document.querySelector(`details[data-id="${CSS.escape(id)}"]`)?.setAttribute('open', '');
}

// Desplegable de menciones: cada grupo con sus arrobas, primero las que siguen sin respuesta
function mentionList(p) {
  const box = el('div', null, 'reds');
  box.append(el('div', `${num(p.mentions)} ${p.mentions === 1 ? 'mención' : 'menciones'} en ${num(p.byGroup.length)} ${p.byGroup.length === 1 ? 'grupo' : 'grupos'}`, 'muted'));
  for (const g of p.byGroup) {
    const rg = el('div', null, 'rg');
    const head = el('div', null, 'rg-head');
    const name = el('span', g.group);
    name.append(el('span', g.client, 'chip'));
    head.append(name, el('span', g.pending ? `${g.count} · ${g.pending} sin respuesta` : `${g.count}`));
    head.title = 'Abrir el grupo';
    head.addEventListener('click', () => goToGroup(g.group, g.groupId));
    rg.append(head);
    for (const c of g.items) {
      const row = el('div', null, 'case');
      const color = !c.answeredAt ? 'red' : LIGHTS.find((l) => l.test(c.wait)).key;
      row.style.borderLeftColor = `var(--${color})`;
      const w = el('span', c.answeredAt ? dur(c.wait) : `sin respuesta · ${dur(c.wait)}`, 'w');
      w.style.color = `var(--${color === 'yellow' ? 'text' : color})`;
      row.append(el('span', `${fmt(c.start)} · ${c.requester}`), w, el('span', c.text, 't'));
      row.title = `${c.answeredAt ? `Respondió ${fmt(c.answeredAt)}` : 'Sin respuesta'}\n${c.text}`;
      rg.append(row);
    }
    box.append(rg);
  }
  return box;
}

function renderInterMentions() {
  const m = report.mentions;
  const thr = dur(report.threshold * 60);
  $('mentionKpis').textContent = m.total
    ? `${num(m.total)} menciones · respuesta mediana ${dur(m.median)} · ${num(m.answered)} respondidas · ${num(m.pending)} sin respuesta (más de ${thr})`
    : 'No hubo menciones a tu equipo en este periodo.';
  // Quien solo tiene menciones sin responder va en rojo
  const light = (p) => (p.median == null ? (p.pending ? LIGHTS[2] : null) : lightOf(p));
  lightBoard($('mentionLights'), 'mentions', m.byMember.filter((p) => p.responses || p.pending), {
    light,
    summary: (p) =>
      `${num(p.mentions)} menciones · ${num(p.responses)} respondidas${p.pending ? ` · ${num(p.pending)} sin respuesta` : ''}${p.responses ? ` · ${colorMix(p)}` : ''}`,
    detail: mentionList,
  });
}

function renderInterTeam() {
  const thr = dur(report.threshold * 60);
  table(
    $('teamTable'),
    [['Persona'], ['Respuestas', 1], ['Citadas', 1], ['Mediana', 1], ['Promedio', 1], [`≤ ${thr}`, 1], ['Mensajes', 1], ['Grupos', 1]],
    report.byMember.map((p) => {
      const tr = el('tr');
      const who = cell(p.name);
      const light = lightOf(p);
      if (light) who.prepend(lamp(light));
      tr.append(
        who,
        cell(num(p.responses), 'num'),
        cell(num(p.explicit), 'num'),
        cell(dur(p.median), 'num'),
        cell(dur(p.avg), 'num'),
        meterCell(p.onTime, p.responses),
        cell(num(p.messages), 'num'),
        cell(num(p.groups), 'num'),
      );
      return tr;
    }),
  );
}

// Matriz persona x cliente con el numero de solicitudes respondidas
function renderInterWho() {
  const members = report.byMember.filter((p) => p.responses);
  const clients = [...new Set(members.flatMap((p) => Object.keys(p.clients)))].sort(
    (a, b) => CLIENTS.indexOf(a) - CLIENTS.indexOf(b),
  );
  const max = Math.max(1, ...members.flatMap((p) => Object.values(p.clients)));
  const head = el('tr');
  head.append(el('th'));
  for (const c of clients) head.append(el('th', c));
  const rows = members.map((p) => {
    const tr = el('tr');
    tr.append(el('th', p.name, 'rowh'));
    for (const c of clients) {
      const n = p.clients[c] ?? 0;
      const td = el('td');
      if (!n) {
        td.className = 'empty';
        td.textContent = '–';
      } else {
        const b = el('button', String(n));
        const tone = Math.round(6 + (n / max) * 84);
        b.style.background = `color-mix(in oklab, var(--seq) ${tone}%, var(--card))`;
        b.style.color = tone > 50 ? 'var(--on-seq)' : 'var(--text)';
        b.style.cursor = 'default';
        tip(b, () => [p.name, `${num(n)} solicitudes de ${c} respondidas`]);
        td.append(b);
      }
      tr.append(td);
    }
    return tr;
  });
  $('whoMatrix').replaceChildren(head, ...rows);
}

function renderInterHours() {
  const max = Math.max(1, ...report.hours.flatMap((h) => [h.counterpart, h.team]));
  $('hourCols').replaceChildren(
    ...report.hours.map((h) => {
      const col = el('div', null, 'col');
      for (const [cls, v] of [['b', h.counterpart], ['a', h.team]]) {
        const bar = el('i', null, cls);
        bar.style.height = `${(v / max) * 100}%`;
        col.append(bar);
      }
      tip(col, () => [`${h.hour}:00 – ${h.hour}:59`, `${num(h.counterpart)} de clientes y proveedores`, `${num(h.team)} del equipo`]);
      return col;
    }),
  );
  $('hourAxis').replaceChildren(...report.hours.map((h) => el('span', h.hour % 3 ? '' : String(h.hour))));
}

function renderInterSlow() {
  table(
    $('slowTable'),
    [['Grupo'], ['Escribió'], ['Respondió'], ['Recibido'], ['Espera', 1], ['Mensaje']],
    report.slowest.map((s) => {
      const tr = el('tr');
      tr.append(cell(s.group), cell(s.requester), cell(s.responder), cell(fmt(s.start)), cell(dur(s.wait), 'num'), cell(s.text.slice(0, 140), 'wrap'));
      return tr;
    }),
  );
}

function renderInteraction() {
  renderInterControls();
  renderInterKpis();
  renderInterAttention();
  renderTrendMedian();
  renderTrendVolume();
  renderInterLights();
  renderInterMentions();
  renderInterPending();
  renderInterClients();
  renderInterTeam();
  renderInterWho();
  renderInterHours();
  renderInterSlow();
}

$('threshold').addEventListener('change', loadInteraction);
