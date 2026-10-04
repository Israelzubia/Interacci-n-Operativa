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

function renderInterKpis() {
  const t = report.totals;
  const thr = dur(report.threshold * 60);
  $('interKpis').replaceChildren(
    kpi('Solicitudes', num(t.requests), `${num(t.byKind.Cliente.requests)} de clientes · ${num(t.byKind.Proveedor.requests)} de proveedores`),
    kpi('Respuesta mediana', dur(t.median), `promedio ${dur(t.avg)}`),
    kpi(`Respondidas en ${thr} o menos`, `${pct(t.onTime, t.answered)}%`, `${num(t.onTime)} de ${num(t.answered)} respondidas`),
    kpi('Sin respuesta', num(t.pending), `más de ${thr} esperando`),
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

function renderInterLights() {
  const people = report.byMember.filter((p) => p.responses);
  $('lights').replaceChildren(
    ...LIGHTS.map((light) => {
      const list = people.filter((p) => lightOf(p) === light).sort((a, b) => a.median - b.median);
      const box = el('div', null, 'light');
      box.style.setProperty('--c', `var(--${light.key})`);
      const h = el('h3');
      const title = el('span');
      title.append(lamp(light), light.label);
      h.append(title, el('span', `${list.length}`, 'muted'));
      box.append(h, el('div', light.range, 'range'));
      if (!list.length) box.append(el('div', 'Nadie en este rango', 'empty'));
      for (const p of list) {
        const row = el('div', null, 'person');
        const split = el('div', null, 'split');
        for (const [k, n] of [['green', p.fast], ['yellow', p.mid], ['red', p.slow]]) {
          const seg = el('i');
          seg.style.flex = String(n);
          seg.style.background = `var(--${k})`;
          split.append(seg);
        }
        row.append(
          el('span', p.name),
          el('span', dur(p.median), 'med'),
          split,
          el('span', `${num(p.responses)} respuestas · ${pct(p.fast, p.responses)}% verde · ${pct(p.mid, p.responses)}% amarillo · ${pct(p.slow, p.responses)}% rojo`, 'sub'),
        );
        tip(split, () => [p.name, `${num(p.fast)} en menos de 5 min`, `${num(p.mid)} de 5 a 9 min`, `${num(p.slow)} en 10 min o más`]);
        box.append(row);
      }
      return box;
    }),
  );
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
        b.style.color = tone > 50 ? '#fff' : 'var(--text)';
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
  renderInterLights();
  renderInterPending();
  renderInterClients();
  renderInterTeam();
  renderInterWho();
  renderInterHours();
  renderInterSlow();
}

$('threshold').addEventListener('change', loadInteraction);
