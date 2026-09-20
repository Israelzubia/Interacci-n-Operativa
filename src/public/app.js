const $ = (id) => document.getElementById(id);
const LABELS = {
  disconnected: 'Sin conexión',
  connecting: 'Conectando…',
  qr: 'Esperando que escanees el QR',
  connected: 'Conectado',
};

let groups = [];
let loadedFor = null;

const post = (url) => fetch(url, { method: 'POST' });

async function loadGroups() {
  const res = await fetch('/api/groups');
  if (!res.ok) return;
  groups = await res.json();
  renderGroups();
}

function renderGroups() {
  const q = $('filter').value.trim().toLowerCase();
  const rows = groups.filter((g) => g.name.toLowerCase().includes(q));
  $('groupsTitle').textContent = `Grupos (${rows.length}${q ? ` de ${groups.length}` : ''})`;
  $('groupsBody').replaceChildren(
    ...rows.map((g) => {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      const count = document.createElement('td');
      name.textContent = g.name;
      count.textContent = g.participants;
      count.className = 'num';
      tr.append(name, count);
      return tr;
    }),
  );
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

  // Carga los grupos una vez por sesion conectada
  if (s.status === 'connected' && loadedFor !== s.user?.id) {
    loadedFor = s.user?.id;
    loadGroups();
  }
  if (s.status !== 'connected') loadedFor = null;
}

$('filter').addEventListener('input', renderGroups);
$('refreshBtn').addEventListener('click', loadGroups);
$('connectBtn').addEventListener('click', async () => { await post('/api/connect'); refresh(); });
$('logoutBtn').addEventListener('click', async () => { await post('/api/logout'); refresh(); });

refresh();
setInterval(refresh, 2000);
