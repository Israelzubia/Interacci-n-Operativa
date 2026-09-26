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

const post = (url) => fetch(url, { method: 'POST' });

async function loadGroups() {
  const res = await fetch('/api/groups');
  if (!res.ok) return false;
  groups = await res.json();
  renderGroups();
  return true;
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
  const sum = document.createElement('summary');
  const name = document.createElement('span');
  const meta = document.createElement('span');
  name.textContent = g.name;
  meta.className = 'meta';
  meta.textContent = g.messageCount
    ? `${g.messageCount} mensajes · último ${fmt(g.lastMessageAt)} · ${g.participants} integrantes`
    : `${g.participants} integrantes`;
  sum.append(name, meta);
  d.append(sum);
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
        renderGroups();
      });
      return b;
    }),
  );
}

function renderGroups() {
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

  // Carga los grupos una vez por sesion conectada; reintenta si aun no estan listos
  if (s.status === 'connected' && loadedFor !== s.user?.id && (await loadGroups())) {
    loadedFor = s.user?.id;
  }
  if (s.status !== 'connected') loadedFor = null;
}

$('filter').addEventListener('input', renderGroups);
$('refreshBtn').addEventListener('click', loadGroups);
$('connectBtn').addEventListener('click', async () => { await post('/api/connect'); refresh(); });
$('logoutBtn').addEventListener('click', async () => { await post('/api/logout'); refresh(); });

refresh();
setInterval(refresh, 2000);
