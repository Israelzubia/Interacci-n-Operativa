const $ = (id) => document.getElementById(id);
const LABELS = {
  disconnected: 'Sin conexión',
  connecting: 'Conectando…',
  qr: 'Esperando que escanees el QR',
  connected: 'Conectado',
};

const CLIENTS = ['Todos', 'MELI', 'WM', 'Onest', 'Estafeta', 'Coppel', 'Amazon', 'Big Ticket', 'Otros'];
const TYPES = ['Todos', 'Clientes', 'Proveedores', 'Interno'];

let groups = [];
let client = 'Todos';
let type = 'Todos';
let loadedFor = null;
// Tiempos de respuesta por grupo (de /api/interaction); usa dur, lamp, lightOf y el de interaction.js
let resp = new Map();
let respDays = 7;

const post = (url) => fetch(url, { method: 'POST' });

async function loadGroups() {
  const res = await fetch('/api/groups');
  if (!res.ok) return false;
  groups = await res.json();
  renderDashboard();
  renderGroups();
  loadResponse();
  return true;
}

async function loadResponse() {
  const res = await fetch(`/api/interaction?days=${respDays}`);
  const report = res.ok ? await res.json() : null;
  if (!report) return;
  resp = new Map(report.byGroup.map((g) => [g.id, g]));
  renderGroups();
}

// Grupos que pasan los filtros de cliente, tipo y busqueda
function visibleGroups() {
  const q = $('filter').value.trim().toLowerCase();
  return groups.filter(
    (g) => (client === 'Todos' || g.client === client) && (type === 'Todos' || g.type === type) && g.name.toLowerCase().includes(q),
  );
}

function openGroup(g) {
  applyFilter('Todos', 'Todos', g.name);
  document.querySelector(`details[data-id="${CSS.escape(g.id)}"]`)?.setAttribute('open', '');
}

function splitBar(r) {
  const split = el('div', null, 'split');
  for (const [k, n] of [['green', r.fast], ['yellow', r.mid], ['red', r.slow]]) {
    const seg = el('i');
    seg.style.flex = String(n);
    seg.style.background = `var(--${k})`;
    split.append(seg);
  }
  return split;
}

function renderResponse() {
  $('respCard').hidden = !resp.size;
  $('respDays').replaceChildren(
    ...[[1, '24 h'], [7, '7 días'], [30, '30 días']].map(([d, label]) => {
      const b = el('button', label);
      b.classList.toggle('active', d === respDays);
      b.addEventListener('click', () => {
        respDays = d;
        loadResponse();
      });
      return b;
    }),
  );
  const shown = visibleGroups().filter((g) => g.type !== 'Interno');
  const rows = shown
    .map((g) => resp.get(g.id))
    .filter((r) => r?.answered)
    .sort((a, b) => b.median - a.median);
  const head = el('tr');
  for (const [label, n] of [[''], ['Grupo'], ['Mediana', 1], ['Respuestas'], ['Solicitudes', 1], ['Promedio', 1], ['Sin respuesta', 1]]) {
    head.append(el('th', label, n ? 'num' : ''));
  }
  $('respTable').replaceChildren(
    head,
    ...rows.map((r) => {
      const tr = el('tr', null, 'click');
      const light = lightOf(r);
      const lampTd = el('td');
      if (light) lampTd.append(lamp(light));
      const bar = el('td');
      bar.append(splitBar(r));
      tip(bar, () => [r.name, `${num(r.fast)} en menos de 5 min`, `${num(r.mid)} de 5 a 9 min`, `${num(r.slow)} en 10 min o más`]);
      const nameTd = el('td', null, 'wrap');
      nameTd.append(el('div', r.name), el('div', `${r.client} · ${r.type}`, 'phone'));
      const med = el('td', dur(r.median), 'num');
      med.style.fontWeight = '600';
      tr.append(
        lampTd,
        nameTd,
        med,
        bar,
        el('td', num(r.requests), 'num'),
        el('td', dur(r.avg), 'num'),
        el('td', num(r.pending), r.pending ? 'num warn' : 'num'),
      );
      tr.addEventListener('click', () => openGroup(groups.find((g) => g.id === r.id) ?? r));
      return tr;
    }),
  );
  const quiet = shown.length - rows.length;
  $('respNote').textContent = rows.length
    ? quiet ? `${quiet} grupos con clientes o proveedores sin solicitudes respondidas en el periodo.` : ''
    : 'No hay solicitudes respondidas con estos filtros en el periodo.';
}

// Resumen de respuesta dentro de un grupo desplegado
function groupResponse(g) {
  const r = resp.get(g.id);
  const div = el('div', null, 'grp-resp');
  if (!r) {
    div.textContent = `Sin solicitudes de clientes o proveedores en ${respDays === 1 ? '24 h' : `${respDays} días`}.`;
    return div;
  }
  const light = lightOf(r);
  if (light) div.append(lamp(light));
  const head = el('strong', `Respuesta mediana ${dur(r.median)}`);
  div.append(head, ` · promedio ${dur(r.avg)} · ${num(r.requests)} solicitudes · ${num(r.pending)} sin respuesta`);
  const team = el('div');
  for (const t of r.team.slice(0, 8)) {
    const who = el('span', null, 'who');
    const l = lightOf(t);
    if (l) who.append(lamp(l));
    who.append(`${t.name}: ${dur(t.median)} (${num(t.responses)})`);
    team.append(who);
  }
  div.append(team);
  return div;
}

const num = (n) => n.toLocaleString('es-MX');
const sum = (list, field) => list.reduce((acc, g) => acc + (g[field] || 0), 0);

// Tooltip compartido por las graficas
function tip(el, lines) {
  const t = $('tip');
  el.addEventListener('mousemove', (e) => {
    t.replaceChildren(
      ...lines().map((l, i) => {
        const div = document.createElement('div');
        div.textContent = l;
        if (i === 0) div.style.fontWeight = '600';
        return div;
      }),
    );
    t.hidden = false;
    const x = Math.min(e.clientX + 14, innerWidth - t.offsetWidth - 8);
    const y = e.clientY + 16 + t.offsetHeight > innerHeight ? e.clientY - t.offsetHeight - 10 : e.clientY + 16;
    t.style.left = `${x}px`;
    t.style.top = `${y}px`;
  });
  el.addEventListener('mouseleave', () => (t.hidden = true));
}

// Aplica filtros desde el panel y lleva a la lista
function applyFilter(c, t, q = '') {
  client = c;
  type = t;
  $('filter').value = q;
  renderDashboard();
  renderGroups();
  $('groupsCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function kpi(label, value, sub) {
  const div = document.createElement('div');
  div.className = 'kpi';
  for (const [cls, text] of [['label', label], ['value', value], ['sub', sub]]) {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    div.append(el);
  }
  return div;
}

function renderKpis() {
  const byType = (t) => groups.filter((g) => g.type === t).length;
  const active = groups.filter((g) => g.messages24h).length;
  const idle = groups.filter((g) => !g.messages7d).length;
  $('kpis').replaceChildren(
    kpi('Grupos', num(groups.length), `${byType('Clientes')} clientes · ${byType('Proveedores')} proveedores · ${byType('Interno')} internos`),
    kpi('Activos en 24 h', num(active), `${Math.round((active / (groups.length || 1)) * 100)}% de los grupos`),
    kpi('Mensajes en 24 h', num(sum(groups, 'messages24h')), `${num(sum(groups, 'messages7d'))} en 7 días`),
    kpi('Sin actividad en 7 días', num(idle), 'Grupos sin mensajes recientes'),
  );
}

// Matriz cliente x tipo; el tono de la celda sigue los mensajes de 24 h
function renderMatrix() {
  const clients = CLIENTS.slice(1);
  const types = TYPES.slice(1);
  const cell = (c, t) => groups.filter((g) => (c === 'Todos' || g.client === c) && (t === 'Todos' || g.type === t));
  const max = Math.max(1, ...clients.flatMap((c) => types.map((t) => sum(cell(c, t), 'messages24h'))));

  const head = document.createElement('tr');
  head.append(document.createElement('th'));
  for (const t of [...types, 'Total']) {
    const th = document.createElement('th');
    th.textContent = t;
    head.append(th);
  }

  const rows = clients.map((c) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.className = 'rowh';
    th.textContent = c;
    tr.append(th);
    for (const t of [...types, 'Todos']) {
      const list = cell(c, t);
      const td = document.createElement('td');
      if (!list.length) {
        td.className = 'empty';
        td.textContent = '–';
        tr.append(td);
        continue;
      }
      const msgs = sum(list, 'messages24h');
      const b = document.createElement('button');
      b.append(String(list.length));
      const small = document.createElement('small');
      small.textContent = `${num(msgs)} msj`;
      b.append(small);
      if (t === 'Todos') {
        td.className = 'total';
      } else {
        const p = Math.round(6 + (msgs / max) * 84);
        b.style.background = `color-mix(in oklab, var(--seq) ${p}%, var(--card))`;
        b.style.color = p > 50 ? 'var(--on-seq)' : 'var(--text)';
      }
      b.classList.toggle('sel', client === c && type === t);
      b.addEventListener('click', () => applyFilter(c, t));
      tip(b, () => [
        `${c} · ${t === 'Todos' ? 'todos los tipos' : t}`,
        `${list.length} grupos · ${list.filter((g) => g.messages24h).length} activos en 24 h`,
        `${num(msgs)} mensajes en 24 h · ${num(sum(list, 'messages7d'))} en 7 días`,
      ]);
      td.append(b);
      tr.append(td);
    }
    return tr;
  });
  $('matrix').replaceChildren(head, ...rows);
}

// Barras horizontales de una sola serie
function renderBars(el, items, onPick) {
  const max = Math.max(1, ...items.map((i) => i.value));
  el.replaceChildren(
    ...items.map((i) => {
      const row = document.createElement('div');
      row.className = 'row';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = i.label;
      const track = document.createElement('div');
      track.className = 'track';
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.width = `${(i.value / max) * 100}%`;
      track.append(bar);
      const n = document.createElement('span');
      n.className = 'num';
      n.textContent = num(i.value);
      row.append(name, track, n);
      row.addEventListener('click', () => onPick(i));
      for (const part of [name, track, n]) tip(part, () => i.tip);
      return row;
    }),
  );
}

function renderDashboard() {
  $('dashboard').hidden = false;
  renderKpis();
  renderMatrix();

  const perClient = CLIENTS.slice(1)
    .map((c) => {
      const list = groups.filter((g) => g.client === c);
      const value = sum(list, 'messages24h');
      return {
        label: c,
        value,
        tip: [c, `${num(value)} mensajes en 24 h`, `${list.filter((g) => g.messages24h).length} de ${list.length} grupos activos`],
      };
    })
    .sort((a, b) => b.value - a.value);
  renderBars($('clientBars'), perClient, (i) => applyFilter(i.label, 'Todos'));

  const top = [...groups]
    .filter((g) => g.messages24h)
    .sort((a, b) => b.messages24h - a.messages24h)
    .slice(0, 10)
    .map((g) => ({
      label: g.name,
      value: g.messages24h,
      group: g,
      tip: [g.name, `${g.client} · ${g.type}`, `${num(g.messages24h)} mensajes en 24 h · ${g.participants} integrantes`],
    }));
  renderBars($('topBars'), top, (i) => {
    applyFilter('Todos', 'Todos', i.group.name);
    document.querySelector(`details[data-id="${CSS.escape(i.group.id)}"]`)?.setAttribute('open', '');
  });
}

const fmt = (ts) => new Date(ts * 1000).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });

async function loadMessages(g, box) {
  const msgs = await (await fetch(`/api/groups/${encodeURIComponent(g.id)}/messages`)).json();
  box.replaceChildren(
    ...msgs.map((m) => {
      const div = document.createElement('div');
      div.className = 'msg';
      const who = document.createElement('span');
      const when = document.createElement('span');
      const txt = document.createElement('div');
      who.className = 'who';
      when.className = 'when';
      txt.className = 'txt';
      who.textContent = m.from;
      when.textContent = fmt(m.ts);
      txt.textContent = m.text;
      div.append(who, when, txt);
      return div;
    }),
  );
  box.scrollTop = box.scrollHeight;
}

function groupItem(g) {
  const d = document.createElement('details');
  d.dataset.id = g.id;
  const head = document.createElement('summary');
  const name = document.createElement('span');
  const meta = document.createElement('span');
  name.textContent = g.name;
  for (const label of [g.client, g.type]) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = label;
    name.append(chip);
  }
  meta.className = 'meta';
  meta.textContent = g.messageCount
    ? `${num(g.messages24h)} en 24 h · último ${fmt(g.lastMessageAt)} · ${g.participants} integrantes`
    : `${g.participants} integrantes`;
  const r = resp.get(g.id);
  if (r?.answered) {
    const light = lightOf(r);
    const rt = el('span', ` resp. ${dur(r.median)}`, 'chip');
    if (light) rt.prepend(lamp(light));
    rt.title = 'Tiempo mediano de respuesta del equipo';
    name.append(rt);
  }
  head.append(name, meta);
  d.append(head);
  if (g.type !== 'Interno') d.append(groupResponse(g));
  if (g.messageCount) {
    const box = document.createElement('div');
    box.className = 'msgs';
    d.append(box);
    d.addEventListener('toggle', () => d.open && loadMessages(g, box));
  }
  return d;
}

// Fila de pestañas; el conteo respeta el filtro de la otra fila
function renderTabs(el, options, field, current, others, onPick) {
  el.replaceChildren(
    ...options.map((o) => {
      const b = document.createElement('button');
      const n = others.filter((g) => o === 'Todos' || g[field] === o).length;
      b.textContent = `${o} (${n})`;
      b.classList.toggle('active', o === current);
      b.addEventListener('click', () => {
        onPick(o);
        renderMatrix();
        renderGroups();
      });
      return b;
    }),
  );
}

function renderGroups() {
  // Conserva los grupos abiertos al volver a dibujar la lista (por ejemplo, en la actualizacion automatica)
  const open = new Set([...document.querySelectorAll('#withList details[open], #withoutList details[open]')].map((d) => d.dataset.id));
  const byClient = (g) => client === 'Todos' || g.client === client;
  const byType = (g) => type === 'Todos' || g.type === type;
  renderTabs($('clientTabs'), CLIENTS, 'client', client, groups.filter(byType), (c) => (client = c));
  renderTabs($('typeTabs'), TYPES, 'type', type, groups.filter(byClient), (t) => (type = t));
  const q = $('filter').value.trim().toLowerCase();
  const rows = groups.filter((g) => byClient(g) && byType(g) && g.name.toLowerCase().includes(q));
  const withMsgs = rows.filter((g) => g.messageCount).sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  const without = rows.filter((g) => !g.messageCount);
  $('groupsTitle').textContent = `Grupos (${rows.length}${rows.length !== groups.length ? ` de ${groups.length}` : ''})`;
  $('withTitle').textContent = `Con mensajes (${withMsgs.length})`;
  $('withoutTitle').textContent = `Sin mensajes (${without.length})`;
  $('withList').replaceChildren(...withMsgs.map(groupItem));
  $('withoutList').replaceChildren(...without.map(groupItem));
  for (const d of document.querySelectorAll('#withList details, #withoutList details')) if (open.has(d.dataset.id)) d.open = true;
  renderResponse();
}

async function refresh() {
  const s = await (await fetch('/api/status')).json();
  $('statusText').textContent = s.user ? `${LABELS[s.status]} · ${s.user.name || s.user.id}` : LABELS[s.status];
  $('dot').classList.toggle('on', s.status === 'connected');
  $('qrBox').hidden = s.status !== 'qr';
  if (s.qr) $('qr').src = s.qr;
  $('logoutBtn').hidden = s.status !== 'connected';
  $('connectBtn').hidden = s.status !== 'disconnected';
  $('groupsCard').hidden = s.status !== 'connected';
  $('views').hidden = s.status !== 'connected';
  if (s.status !== 'connected') $('dashboard').hidden = $('respCard').hidden = true;

  // Carga los grupos una vez por sesion conectada; reintenta si aun no estan listos
  if (s.status === 'connected' && loadedFor !== s.user?.id && (await loadGroups())) {
    loadedFor = s.user?.id;
    markUpdated();
  }
  if (s.status !== 'connected') loadedFor = null;
}

$('filter').addEventListener('input', renderGroups);
$('refreshBtn').addEventListener('click', loadGroups);
$('connectBtn').addEventListener('click', async () => { await post('/api/connect'); refresh(); });
$('logoutBtn').addEventListener('click', async () => {
  const ok = confirm(
    '¿Cerrar la sesión de WhatsApp?\n\nSe desvincula este dispositivo y la plataforma deja de recibir mensajes hasta que vuelvas a escanear el QR.',
  );
  if (!ok) return;
  await post('/api/logout');
  refresh();
});

refresh();
setInterval(refresh, 2000);

// Actualizacion automatica de los datos cada 10 minutos
const AUTO_REFRESH_MIN = 10;
function markUpdated() {
  const time = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  $('updated').textContent = `Actualizado ${time} · se actualiza cada ${AUTO_REFRESH_MIN} min`;
}
async function autoRefresh() {
  if (!loadedFor) return;
  await loadGroups();
  if (!$('viewInteraction').hidden) await loadInteraction();
  markUpdated();
}
setInterval(autoRefresh, AUTO_REFRESH_MIN * 60 * 1000);
