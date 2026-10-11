// Vista de interaccion: tiempos de respuesta del equipo con clientes y proveedores.
// Usa $, num, kpi, tip, fmt, applyFilter (app.js) y showView (people.js).
const PERIODS = [[1, '24 h'], [7, '7 días'], [30, '30 días']];
let days = 7;
let report = null;
let areaSel = 'Todas';
// Filtro de cuenta (MELI / Multicuentas) para la atencion de grupos y los pendientes
let acctSel = 'Todas';
const inAcct = (g) => acctSel === 'Todas' || g.account === acctSel;
let areaOrder = [];
// Filtro de area: aplica a las secciones por persona del equipo
const inArea = (p) => areaSel === 'Todas' || p.area === areaSel;

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
  areaOrder = await (await fetch('/api/areas')).json().catch(() => []);
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
    .filter(inAcct)
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
    .filter((p) => p.responses >= 5 && inArea(p))
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
  const goodT = report.byMember.filter((p) => inArea(p) && p.responses >= 5 && better(p.median, p.prev.median));
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
  const list = report.pending.filter(inAcct);
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
        const who = el('span', p.name);
        if (p.area && areaSel === 'Todas') who.append(el('span', p.area, 'chip area-chip'));
        if (p.restDays?.length) who.append(el('span', restLabel(p), 'chip area-chip'));
        row.append(who, el('span', p.median == null ? 'sin respuesta' : dur(p.median), 'med'), split, el('span', summary(p), 'sub'));
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

const DAY_NAMES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const restLabel = (p) => (p.restDays?.length ? `descansa ${p.restDays.map((d) => DAY_NAMES[d]).join(' y ')}` : '');

const colorMix = (p) => `${pct(p.fast, p.responses)}% verde · ${pct(p.mid, p.responses)}% amarillo · ${pct(p.slow, p.responses)}% rojo`;

function renderInterLights() {
  lightBoard($('lights'), 'answers', report.byMember.filter((p) => p.responses && inArea(p)), {
    summary: (p) =>
      `${num(p.responses)} respuestas · ${colorMix(p)}${p.rest?.responses ? ` · en su descanso respondió ${num(p.rest.responses)} (mediana ${dur(p.rest.median)}, no cuentan)` : ''}`,
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
      if (c.rest) {
        // Mencion en su dia de descanso: se registra pero no cuenta
        row.classList.add('rest');
        w.textContent = `día de descanso · ${c.answeredAt ? dur(c.wait) : 'sin respuesta'}`;
        w.style.color = 'var(--muted)';
      }
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
  // Con un area elegida, el resumen es el de esa area
  const a = areaSel === 'Todas' ? { mentions: m.total, median: m.median, responses: m.answered, pending: m.pending } : m.byArea.find((x) => x.area === areaSel);
  $('mentionKpis').textContent = a?.mentions
    ? `${num(a.mentions)} menciones${areaSel === 'Todas' ? '' : ` a ${areaSel}`} · respuesta mediana ${dur(a.median)} · ${num(a.responses)} respondidas · ${num(a.pending)} sin respuesta (más de ${thr})${areaSel === 'Todas' && m.onRest ? ` · ${num(m.onRest)} en día de descanso, no cuentan` : ''}`
    : 'No hubo menciones en este periodo.';
  // Quien solo tiene menciones sin responder va en rojo
  const light = (p) => (p.median == null ? (p.pending ? LIGHTS[2] : null) : lightOf(p));
  lightBoard($('mentionLights'), 'mentions', m.byMember.filter((p) => (p.responses || p.pending || p.rest?.mentions) && inArea(p)), {
    light,
    summary: (p) =>
      `${num(p.mentions)} menciones · ${num(p.responses)} respondidas${p.pending ? ` · ${num(p.pending)} sin respuesta` : ''}${p.responses ? ` · ${colorMix(p)}` : ''}${p.rest?.mentions ? ` · ${num(p.rest.mentions)} en su descanso (no cuentan)` : ''}`,
    detail: mentionList,
  });
}

function renderInterTeam() {
  const thr = dur(report.threshold * 60);
  table(
    $('teamTable'),
    [['Persona'], ['Respuestas', 1], ['Citadas', 1], ['Mediana', 1], ['Promedio', 1], [`≤ ${thr}`, 1], ['Mensajes', 1], ['Grupos', 1]],
    report.byMember.filter(inArea).map((p) => {
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
  const members = report.byMember.filter((p) => p.responses && inArea(p));
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

// Areas presentes en el reporte, en el orden de Personas y "Sin área" al final
function reportAreas() {
  const seen = new Set([...report.byMember.map((p) => p.area), ...report.mentions.byMember.map((p) => p.area)]);
  return [...areaOrder.filter((a) => seen.has(a)), ...[...seen].filter((a) => a !== 'Sin área' && !areaOrder.includes(a)), ...(seen.has('Sin área') ? ['Sin área'] : [])];
}

function setArea(a) {
  areaSel = a;
  renderInteraction();
}

function renderInterAreaFilter() {
  const list = reportAreas();
  if (!list.includes(areaSel)) areaSel = 'Todas';
  $('areaFilter').replaceChildren(
    ...['Todas', ...list].map((a) => {
      const b = el('button', a);
      b.classList.toggle('active', a === areaSel);
      b.addEventListener('click', () => setArea(a));
      return b;
    }),
  );
}

function renderInterAreas() {
  const mentions = new Map(report.mentions.byArea.map((a) => [a.area, a]));
  const thr = dur(report.threshold * 60);
  $('areaCards').replaceChildren(
    ...reportAreas().map((area) => {
      const a = report.byArea.find((x) => x.area === area) ?? { area, responses: 0, people: 0, fast: 0, mid: 0, slow: 0, daily: [] };
      const mt = mentions.get(area);
      const light = lightOf(a);
      const card = el('div', null, 'area-card');
      card.classList.toggle('sel', areaSel === area);
      card.style.setProperty('--c', light ? `var(--${light.key})` : 'var(--line)');
      const head = el('div', null, 'head');
      const name = el('span');
      if (light) name.append(lamp(light));
      name.append(area);
      head.append(name, a.daily.length ? spark(a.daily, 80, 22) : el('span'));
      const split = el('div', null, 'split');
      for (const [k, n] of [['green', a.fast], ['yellow', a.mid], ['red', a.slow]]) {
        const seg = el('i');
        seg.style.flex = String(n);
        seg.style.background = `var(--${k})`;
        split.append(seg);
      }
      card.append(
        head,
        el('div', a.responses ? dur(a.median) : '–', 'big'),
        el('div', a.responses ? `${pct(a.onTime, a.responses)}% en ${thr} o menos · ${num(a.responses)} respuestas · ${num(a.people)} ${a.people === 1 ? "persona" : "personas"}` : 'Sin respuestas en el periodo', 'sub'),
        split,
        el('div', mt ? `Menciones: ${num(mt.mentions)} · mediana ${dur(mt.median)}${mt.pending ? ` · ${num(mt.pending)} sin respuesta` : ''}` : 'Sin menciones', 'sub'),
      );
      tip(split, () => [area, `${num(a.fast)} en menos de 5 min`, `${num(a.mid)} de 5 a 9 min`, `${num(a.slow)} en 10 min o más`]);
      card.addEventListener('click', () => setArea(areaSel === area ? 'Todas' : area));
      return card;
    }),
  );
}

// --- Reporte de rutas cada 2 h (proveedores MELI) ---
const hhmm = (ts) => new Date(ts * 1000).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
// Semaforo de cumplimiento: verde 90% o mas, amarillo 70-89%, rojo menos de 70%
const complianceLight = (c) => (c == null ? null : c >= 0.9 ? 'green' : c >= 0.7 ? 'yellow' : 'red');
const SLOT_STYLE = {
  onTime: ['green', (s) => `✓ ${hhmm(s.sentAt)}`],
  late: ['yellow', (s) => `tarde ${hhmm(s.sentAt)} (+${dur(s.delay)})`],
  missed: ['red', () => 'omitido'],
  overdue: ['red', () => 'vencido, sin reporte'],
  upcoming: ['line', () => 'próximo'],
};

function slotChip(s) {
  const [color, text] = SLOT_STYLE[s.status];
  const chip = el('span', null, `slot ${s.status}`);
  chip.style.setProperty('--c', `var(--${color})`);
  chip.append(el('b', hhmm(s.due)), ` ${text(s)}`);
  chip.title = s.sender ? `Envió ${s.sender}` : '';
  return chip;
}

function renderInterReports() {
  const r = report.reports;
  if (!r?.groups) {
    $('reportCard').hidden = true;
    return;
  }
  $('reportCard').hidden = false;
  const tol = dur(r.rule.tolerance);
  $('reportHint').textContent =
    `Monitoreo debe mandar el reporte de rutas (imagen con la palabra "avance") cada 2 h en los ${r.groups} grupos de cuenta MELI y tipo Proveedores. ` +
    `El primer reporte vence 2 h después del primer mensaje del día en cada grupo, nunca antes de las 10:00, y el último a las 22:00. ` +
    `A tiempo: hasta ${tol} después de la hora. Clic en un grupo para abrirlo.`;
  const t = r.totals;
  const evaluated = t.onTime + t.late + t.missed;
  const startLabel = new Date(`${r.rule.startDay}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  $('reportKpis').textContent = !r.started
    ? `La regla se mide a partir del ${startLabel}. Ese día aquí verás el cumplimiento de cada grupo.`
    : evaluated
    ? `Cumplimiento ${pct(t.onTime, evaluated)}% · ${num(t.onTime)} a tiempo · ${num(t.late)} tarde${t.avgDelay ? ` (retraso promedio ${dur(t.avgDelay)})` : ''} · ${num(t.missed)} omitidos`
    : 'Todavía no hay reportes por evaluar en este periodo.';
  const head = el('tr');
  for (const [label, n] of [['Grupo'], ['Cumplimiento', 1], ['A tiempo', 1], ['Tarde', 1], ['Omitidos', 1], ['Hoy']]) head.append(el('th', label, n ? 'num' : ''));
  $('reportTable').replaceChildren(
    head,
    ...r.byGroup.map((g) => {
      const tr = el('tr', null, 'click');
      const name = el('td', null, 'wrap');
      const link = el('span', g.name);
      link.style.cursor = 'pointer';
      link.addEventListener('click', () => goToGroup(g.name, g.id));
      name.append(link);
      if (g.today) name.append(el('div', `inicio hoy ${hhmm(g.today.start)}`, 'phone'));
      const comp = el('td', null, 'num');
      const c = complianceLight(g.compliance);
      if (c) comp.append(lamp(LIGHTS.find((l) => l.key === c)));
      comp.append(g.compliance == null ? '–' : `${Math.round(g.compliance * 100)}%`);
      const today = el('td');
      const slots = el('div', null, 'slots');
      if (g.today?.slots.length) for (const s of g.today.slots) slots.append(slotChip(s));
      else slots.append(el('span', !r.started ? 'Aún no inicia la regla' : g.today ? 'Sin reportes por vencer hoy' : 'Sin actividad hoy', 'muted'));
      today.append(slots);
      tr.append(name, comp, el('td', num(g.onTime), 'num'), el('td', num(g.late), 'num'), el('td', num(g.missed), g.missed ? 'num warn' : 'num'), today);
      return tr;
    }),
  );
  $('reportPeople').textContent = r.byMember.length
    ? `Reportes enviados por Monitoreo: ${r.byMember.map((p) => `${p.name} ${num(p.reports)} (${pct(p.onTime, p.reports)}% a tiempo)`).join(' · ')}`
    : 'Monitoreo no ha enviado reportes en este periodo.';
  $('reportDays').replaceChildren(
    ...r.byDay.map((d) => {
      const evaluatedDay = d.onTime + d.late + d.missed;
      const c = d.compliance;
      const box = el('div', null, 'd');
      const bar = el('div', null, 'bar');
      const fill = el('i');
      fill.style.height = `${Math.round((c ?? 0) * 100)}%`;
      box.style.setProperty('--c', `var(--${complianceLight(c) ?? 'line'})`);
      bar.append(fill);
      box.append(bar, el('div', c == null ? '–' : `${Math.round(c * 100)}%`, 'v'), el('div', dayLabel(d.day)));
      tip(box, () => [dayLong(d.day), `${num(d.onTime)} a tiempo · ${num(d.late)} tarde · ${num(d.missed)} omitidos`, `${num(evaluatedDay)} reportes evaluados`]);
      return box;
    }),
  );
}

// --- MELI vs Multicuentas ---
const CMP_ACCOUNTS = [['MELI', 'var(--cat1)'], ['Multicuentas', 'var(--cat2)']];

function renderInterAccounts() {
  const data = CMP_ACCOUNTS.map(([name, color]) => ({ name, color, a: report.byAccount.find((x) => x.account === name), m: report.mentions.byAccount?.[name] }));
  if (!data.some((d) => d.a)) {
    $('acctCard').hidden = true;
    return;
  }
  $('acctCard').hidden = false;
  const thr = dur(report.threshold * 60);
  const head = el('tr');
  head.append(el('th'));
  for (const d of data) {
    const th = el('th', d.name, 'acct-h');
    th.style.setProperty('--c', d.color);
    th.classList.toggle('sel', acctSel === d.name);
    th.title = 'Filtrar la atención y los pendientes por esta cuenta';
    th.addEventListener('click', () => {
      acctSel = acctSel === d.name ? 'Todas' : d.name;
      renderInteraction();
    });
    head.append(th);
  }
  // Fila de comparacion; better: 'low' o 'high' marca el mejor valor con ✓
  const mins = (secs) => (secs == null ? null : Math.floor(secs / 60));
  const row = (label, value, show, better) => {
    const tr = el('tr');
    tr.append(el('td', label));
    const vals = data.map((d) => (d.a ? value(d) : null));
    const ok = vals.filter((v) => v != null);
    const best = better && ok.length === 2 && ok[0] !== ok[1] ? (better === 'low' ? Math.min(...ok) : Math.max(...ok)) : null;
    data.forEach((d, i) => {
      const td = el('td');
      const content = d.a ? show(d) : '–';
      if (content instanceof Node) td.append(content);
      else td.textContent = content;
      if (best != null && vals[i] === best) td.classList.add('best');
      tr.append(td);
    });
    return tr;
  };
  const medianCell = (d) => {
    const span = el('span');
    const light = lightOf(d.a);
    if (light) span.append(lamp(light));
    span.append(dur(d.a.median));
    return span;
  };
  const mix = (d) => {
    const split = el('span', null, 'split');
    for (const [k, n] of [['green', d.a.fast], ['yellow', d.a.mid], ['red', d.a.slow]]) {
      const seg = el('i');
      seg.style.flex = String(n);
      seg.style.background = `var(--${k})`;
      seg.style.height = '8px';
      split.append(seg);
    }
    tip(split, () => [d.name, `${num(d.a.fast)} en menos de 5 min`, `${num(d.a.mid)} de 5 a 9 min`, `${num(d.a.slow)} en 10 min o más`]);
    return split;
  };
  const slowest = (d) => {
    const box = el('span');
    if (!d.a.slowest.length) box.textContent = '–';
    for (const g of d.a.slowest) {
      const s = el('span', `${g.name} · ${dur(g.median)}`, 'slow-g');
      s.addEventListener('click', () => goToGroup(g.name, g.id));
      box.append(s);
    }
    return box;
  };
  const rows = [
    row('Grupos con solicitudes', (d) => d.a.groups, (d) => num(d.a.groups)),
    row('Solicitudes', (d) => d.a.requests, (d) => num(d.a.requests)),
    row('Respuesta mediana', (d) => mins(d.a.median), medianCell, 'low'),
    row('Promedio', (d) => mins(d.a.avg), (d) => dur(d.a.avg), 'low'),
    row(`Respondidas en ${thr} o menos`, (d) => pct(d.a.onTime, d.a.answered), (d) => `${pct(d.a.onTime, d.a.answered)}%`, 'high'),
    row('Sin respuesta ahora', (d) => d.a.pending, (d) => num(d.a.pending), 'low'),
    row('Respuestas por color', () => 0, mix),
    row('Menciones (@): mediana', (d) => mins(d.m?.median ?? null), (d) => (d.m ? `${dur(d.m.median)} · ${num(d.m.mentions)} menciones` : '–'), 'low'),
    row('Menciones sin respuesta', (d) => d.m?.pending ?? 0, (d) => num(d.m?.pending ?? 0), 'low'),
  ];
  if (report.prevComplete) {
    rows.push(row('Mediana vs periodo anterior', (d) => (d.a.prev.median == null ? null : mins(d.a.median) - mins(d.a.prev.median)), (d) =>
      {
        if (d.a.prev.median == null) return '–';
        const dm = mins(d.a.median) - mins(d.a.prev.median);
        return dm === 0 ? 'igual' : `${dm < 0 ? '▼' : '▲'} ${Math.abs(dm)} min`;
      }, 'low'));
  }
  rows.push(row('Grupos más lentos', () => 0, slowest));
  $('acctCmp').replaceChildren(head, ...rows);
  renderAccountTrend(data);
}

// Lineas de mediana diaria por cuenta, en el mismo eje
function renderAccountTrend(data) {
  const series = report.trend;
  const lines = data
    .filter((d) => d.a)
    .map((d) => {
      const byDay = new Map(d.a.trend.map((t) => [t.day, t]));
      return { ...d, vals: series.map((s) => byDay.get(s.day)?.median ?? null), byDay };
    });
  const all = lines.flatMap((l) => l.vals).filter((v) => v != null).map((v) => v / 60);
  // Eje hasta 60 min como maximo: un dia atipico no aplasta la grafica (el valor real va en el tooltip)
  const peak = Math.max(0, ...all);
  const top = Math.min(60, Math.max(15, Math.ceil(peak / 5) * 5));
  const f = frame(series, 220, top, [0, 5, 10, ...(top > 10 ? [top] : [])], (t) => (t === top && peak > top ? `${t}+ min` : `${t} min`));
  for (const [from, to, c] of [[0, 5, 'green'], [5, 10, 'yellow'], [10, top, 'red']]) {
    f.svg.insertBefore(svgEl('rect', { x: f.L, width: f.W - f.L - f.R, y: f.y(to), height: f.y(from) - f.y(to), fill: `var(--${c})`, opacity: 0.06 }), f.svg.firstChild);
  }
  for (const l of lines) {
    let d = '';
    l.vals.forEach((v, i) => {
      if (v == null) return;
      d += `${d && l.vals[i - 1] != null ? 'L' : 'M'}${f.x(i).toFixed(1)},${f.y(v / 60).toFixed(1)}`;
    });
    f.svg.append(svgEl('path', { d, fill: 'none', stroke: l.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    l.vals.forEach((v, i) => {
      if (v != null) f.svg.append(svgEl('circle', { cx: f.x(i), cy: f.y(v / 60), r: 4, fill: l.color, stroke: 'var(--card)', 'stroke-width': 2 }));
    });
  }
  hitAreas(f, series, (s) => [
    dayLong(s.day),
    ...lines.map((l) => {
      const t = l.byDay.get(s.day);
      return t ? `${l.name}: ${dur(t.median)} · ${num(t.requests)} solicitudes` : `${l.name}: sin datos`;
    }),
  ]);
  $('acctTrend').replaceChildren(f.svg);
  $('acctLegend').replaceChildren(
    ...lines.map((l) => {
      const sp = el('span', l.name);
      sp.style.setProperty('--c', l.color);
      return sp;
    }),
  );
}

function renderInteraction() {
  renderInterAreaFilter();
  renderInterReports();
  renderInterAccounts();
  renderInterAreas();
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
