// Vista de personas: directorio con rol (Equipo, Cliente, Proveedor) para revisar y confirmar.
// Usa $, num y tip definidos en app.js.
const ROLE_TABS = ['Todos', 'Equipo', 'Cliente', 'Proveedor', 'Sin clasificar'];
const MAX_ROWS = 200;

let people = [];
let roleTab = 'Todos';
let peopleLoaded = false;

const roleOf = (p) => p.role ?? 'Sin clasificar';

async function loadPeople() {
  $('peopleTitle').textContent = 'Personas · cargando…';
  const res = await fetch('/api/people');
  if (!res.ok) return;
  people = await res.json();
  peopleLoaded = true;
  fillGroupFilter();
  renderPeople();
}

function fillGroupFilter() {
  const current = $('groupFilter').value;
  const names = [...new Set(people.flatMap((p) => p.groups))].sort((a, b) => a.localeCompare(b, 'es'));
  $('groupFilter').replaceChildren(
    new Option('Todos los grupos', ''),
    ...names.map((n) => new Option(n, n)),
  );
  $('groupFilter').value = names.includes(current) ? current : '';
}

async function saveRole(list, role) {
  if (!list.length) return;
  const res = await fetch('/api/people/role', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jids: list.map((p) => p.jid), role }),
  });
  if (!res.ok) return alert('No se pudo guardar el rol');
  for (const p of list) {
    p.role = role ?? p.suggested;
    p.confirmed = !!role;
  }
  renderPeople();
}

// Personas que pasan los filtros de busqueda, grupo y "por confirmar" (sin el filtro de rol)
function baseFiltered() {
  const q = $('peopleFilter').value.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const group = $('groupFilter').value;
  const pending = $('pendingOnly').checked;
  return people.filter(
    (p) =>
      (!q || (p.name ?? '').toLowerCase().includes(q) || (digits && (p.phone ?? '').includes(digits))) &&
      (!group || p.groups.includes(group)) &&
      (!pending || !p.confirmed),
  );
}

function renderPeopleKpis() {
  const cards = ['Equipo', 'Cliente', 'Proveedor'].map((r) => {
    const list = people.filter((p) => p.role === r);
    return kpi(r, num(list.length), `${num(list.filter((p) => p.confirmed).length)} confirmadas`);
  });
  const pending = people.filter((p) => !p.confirmed).length;
  cards.push(kpi('Por confirmar', num(pending), `de ${num(people.length)} personas`));
  $('peopleKpis').replaceChildren(...cards);
}

function roleSelect(p) {
  const sel = document.createElement('select');
  sel.append(new Option('Sin clasificar', ''), ...['Equipo', 'Cliente', 'Proveedor'].map((r) => new Option(r, r)));
  sel.value = p.role ?? '';
  sel.classList.toggle('suggested', !p.confirmed);
  sel.title = p.confirmed ? 'Rol confirmado' : 'Rol sugerido, sin confirmar';
  sel.addEventListener('change', () => saveRole([p], sel.value || null));
  return sel;
}

function personRow(p) {
  const tr = document.createElement('tr');

  const who = document.createElement('td');
  const name = document.createElement('div');
  name.className = 'who';
  name.textContent = (p.name ?? 'Sin nombre') + (p.isMe ? ' (tú)' : '');
  const phone = document.createElement('div');
  phone.className = 'phone';
  phone.textContent = p.phone ?? 'Número no disponible';
  who.append(name, phone);

  const groupsTd = document.createElement('td');
  groupsTd.className = 'num';
  groupsTd.textContent = p.groupCount;
  tip(groupsTd, () => [`${p.groupCount} grupos`, ...p.groups.slice(0, 12), ...(p.groups.length > 12 ? [`y ${p.groups.length - 12} más…`] : [])]);

  const clientsTd = document.createElement('td');
  for (const c of p.clients.slice(0, 3)) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.marginLeft = '0';
    chip.style.marginRight = '4px';
    chip.textContent = c;
    clientsTd.append(chip);
  }

  const msgs = document.createElement('td');
  msgs.className = 'num';
  msgs.textContent = num(p.messages);

  const roleTd = document.createElement('td');
  roleTd.append(roleSelect(p));
  if (p.confirmed) {
    const ok = document.createElement('span');
    ok.className = 'ok';
    ok.textContent = '✓ confirmado';
    roleTd.append(ok);
  } else if (p.suggested) {
    const b = document.createElement('button');
    b.textContent = 'Confirmar';
    b.style.cssText = 'margin-left:6px;padding:3px 10px;font-size:.8rem';
    b.addEventListener('click', () => saveRole([p], p.suggested));
    roleTd.append(b);
  }

  tr.append(who, groupsTd, clientsTd, msgs, roleTd);
  return tr;
}

function renderPeople() {
  renderPeopleKpis();
  const base = baseFiltered();
  $('roleTabs').replaceChildren(
    ...ROLE_TABS.map((r) => {
      const b = document.createElement('button');
      const n = base.filter((p) => r === 'Todos' || roleOf(p) === r).length;
      b.textContent = `${r} (${num(n)})`;
      b.classList.toggle('active', r === roleTab);
      b.addEventListener('click', () => {
        roleTab = r;
        renderPeople();
      });
      return b;
    }),
  );

  const rows = base.filter((p) => roleTab === 'Todos' || roleOf(p) === roleTab);
  $('peopleTitle').textContent = `Personas (${num(rows.length)}${rows.length !== people.length ? ` de ${num(people.length)}` : ''})`;
  $('peopleBody').replaceChildren(...rows.slice(0, MAX_ROWS).map(personRow));
  $('peopleMore').textContent =
    rows.length > MAX_ROWS ? `Mostrando ${MAX_ROWS} de ${num(rows.length)}. Usa la búsqueda o el filtro de grupo para ver el resto.` : '';

  // Acciones en bloque cuando hay un filtro de grupo o busqueda activo
  const filtered = $('groupFilter').value || $('peopleFilter').value.trim();
  $('bulk').hidden = !filtered || !rows.length;
  $('bulkText').textContent = `Asignar rol a las ${num(rows.length)} personas mostradas:`;
  $('bulk').onclick = (e) => {
    const role = e.target.dataset?.role;
    if (role) saveRole(rows, role);
  };
}

function showView(view) {
  for (const b of $('views').querySelectorAll('button')) b.classList.toggle('active', b.dataset.view === view);
  $('viewGroups').hidden = view !== 'groups';
  $('viewPeople').hidden = view !== 'people';
  if (view === 'people' && !peopleLoaded) loadPeople();
}

$('views').addEventListener('click', (e) => e.target.dataset?.view && showView(e.target.dataset.view));
$('peopleRefresh').addEventListener('click', loadPeople);
for (const id of ['peopleFilter', 'groupFilter', 'pendingOnly']) $(id).addEventListener('input', renderPeople);
