// Vista de personas: directorio con rol (Equipo, Cliente, Proveedor) para revisar y confirmar.
// Usa $, num y tip definidos en app.js.
const ROLE_TABS = ['Todos', 'Equipo', 'Cliente', 'Proveedor', 'Sin clasificar'];
const MAX_ROWS = 200;

let people = [];
let roleTab = 'Todos';
let peopleLoaded = false;
let areas = [];
let areaTab = 'Todas';

const roleOf = (p) => p.role ?? 'Sin clasificar';

async function loadPeople() {
  $('peopleTitle').textContent = 'Personas · cargando…';
  const res = await fetch('/api/people');
  if (!res.ok) return;
  people = await res.json();
  areas = await (await fetch('/api/areas')).json();
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

// Cambia el nombre por un campo de texto; Enter o salir del campo guarda, Esc cancela.
// Dejarlo vacio regresa al nombre de la agenda o de WhatsApp.
function editName(p, who) {
  const input = document.createElement('input');
  input.className = 'name-input';
  input.value = p.customName ?? p.name ?? '';
  input.placeholder = 'Nombre de la persona';
  input.maxLength = 80;
  who.firstChild.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    if (!save || value === (p.customName ?? '')) return renderPeople();
    const res = await fetch('/api/people/name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jid: p.jid, name: value }),
    });
    if (!res.ok) {
      alert('No se pudo guardar el nombre');
      return renderPeople();
    }
    if (value) {
      p.customName = value;
      p.name = value;
      renderPeople();
    } else {
      loadPeople();
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

function personRow(p) {
  const tr = document.createElement('tr');

  const who = document.createElement('td');
  const name = document.createElement('div');
  name.className = 'who';
  name.textContent = (p.name ?? 'Sin nombre') + (p.isMe ? ' (tú)' : '');
  const edit = document.createElement('button');
  edit.className = 'edit';
  edit.textContent = '✎';
  edit.title = 'Escribir el nombre a mano';
  edit.addEventListener('click', () => editName(p, who));
  name.append(edit);
  const phone = document.createElement('div');
  phone.className = 'phone';
  phone.textContent = (p.phone ?? 'Número no disponible') + (p.customName ? ' · nombre escrito a mano' : '');
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

// --- Areas del equipo ---
const teamMembers = () => people.filter((p) => p.role === 'Equipo' && (p.confirmed || p.isMe));
const areaLabel = (p) => p.area ?? 'Sin área';

async function saveArea(list, area) {
  if (!list.length) return;
  const res = await fetch('/api/people/area', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jids: list.map((p) => p.jid), area }),
  });
  if (!res.ok) return alert('No se pudo guardar el área');
  for (const p of list) {
    p.area = area ?? p.areaSuggested;
    p.areaConfirmed = !!area;
  }
  renderAreas();
}

function areaSelect(p) {
  const sel = document.createElement('select');
  sel.append(new Option('Sin área', ''), ...areas.map((a) => new Option(a, a)));
  sel.value = p.area ?? '';
  sel.classList.toggle('suggested', !p.areaConfirmed);
  sel.title = p.areaConfirmed ? 'Área confirmada' : 'Área sugerida, sin confirmar';
  sel.addEventListener('change', () => saveArea([p], sel.value || null));
  return sel;
}

function areaRow(p) {
  const tr = document.createElement('tr');
  const who = document.createElement('td');
  const name = document.createElement('div');
  name.className = 'who';
  name.textContent = (p.name ?? 'Sin nombre') + (p.isMe ? ' (tú)' : '');
  const phone = document.createElement('div');
  phone.className = 'phone';
  phone.textContent = p.phone ?? '';
  who.append(name, phone);
  const groupsTd = document.createElement('td');
  groupsTd.className = 'num';
  groupsTd.textContent = p.groupCount;
  const msgs = document.createElement('td');
  msgs.className = 'num';
  msgs.textContent = num(p.messages);
  const areaTd = document.createElement('td');
  areaTd.append(areaSelect(p));
  if (p.areaConfirmed) {
    const ok = document.createElement('span');
    ok.className = 'ok';
    ok.textContent = '✓ confirmado';
    areaTd.append(ok);
  } else if (p.areaSuggested) {
    const b = document.createElement('button');
    b.textContent = 'Confirmar';
    b.style.cssText = 'margin-left:6px;padding:3px 10px;font-size:.8rem';
    b.addEventListener('click', () => saveArea([p], p.areaSuggested));
    areaTd.append(b);
  }
  const restTd = document.createElement('td');
  restTd.append(restPicker(p));
  tr.append(who, groupsTd, msgs, areaTd, restTd);
  return tr;
}

// Dias de descanso: lunes a domingo (0 = domingo)
const WEEK = [[1, 'L', 'lunes'], [2, 'M', 'martes'], [3, 'M', 'miércoles'], [4, 'J', 'jueves'], [5, 'V', 'viernes'], [6, 'S', 'sábado'], [0, 'D', 'domingo']];

function restPicker(p) {
  const box = document.createElement('span');
  box.className = 'restdays';
  for (const [d, short, long] of WEEK) {
    const b = document.createElement('button');
    b.textContent = short;
    b.title = long;
    b.classList.toggle('on', p.rest.includes(d));
    b.addEventListener('click', async () => {
      const days = p.rest.includes(d) ? p.rest.filter((x) => x !== d) : [...p.rest, d];
      const res = await fetch('/api/people/rest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid: p.jid, days }),
      });
      if (!res.ok) return alert('No se pudo guardar el descanso');
      p.rest = days;
      b.classList.toggle('on', days.includes(d));
    });
    box.append(b);
  }
  return box;
}

function renderAreas() {
  const team = teamMembers();
  const tabs = ['Todas', ...areas, 'Sin área'];
  if (!tabs.includes(areaTab)) areaTab = 'Todas';
  $('areaTabs').replaceChildren(
    ...tabs.map((a) => {
      const b = document.createElement('button');
      const n = team.filter((p) => a === 'Todas' || areaLabel(p) === a).length;
      b.textContent = `${a} (${n})`;
      b.classList.toggle('active', a === areaTab);
      b.addEventListener('click', () => {
        areaTab = a;
        renderAreas();
      });
      return b;
    }),
  );
  const rows = team.filter((p) => areaTab === 'Todas' || areaLabel(p) === areaTab).sort((a, b) => b.messages - a.messages);
  const confirmed = team.filter((p) => p.areaConfirmed).length;
  $('areasTitle').textContent = `Áreas del equipo (${num(confirmed)} de ${num(team.length)} confirmadas)`;
  $('areaBody').replaceChildren(...rows.map(areaRow));
  // Confirmar en bloque las sugerencias de las personas mostradas
  const pending = rows.filter((p) => !p.areaConfirmed && p.areaSuggested);
  $('areaBulk').hidden = !pending.length;
  $('areaBulkText').textContent = `${num(pending.length)} ${pending.length === 1 ? 'persona tiene' : 'personas tienen'} un área sugerida sin confirmar.`;
  $('areaBulkBtn').onclick = async () => {
    for (const [area, list] of Object.entries(Object.groupBy(pending, (p) => p.areaSuggested))) await saveArea(list, area);
  };
}

$('addArea').addEventListener('click', async () => {
  const name = prompt('Nombre de la nueva área:');
  if (!name?.trim()) return;
  const res = await fetch('/api/areas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) return alert(out.error ?? 'No se pudo crear el área');
  areas = out;
  renderAreas();
});

function renderPeople() {
  renderPeopleKpis();
  renderAreas();
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
  $('viewInteraction').hidden = view !== 'interaction';
  if (view === 'people' && !peopleLoaded) loadPeople();
  if (view === 'interaction') loadInteraction();
}

$('views').addEventListener('click', (e) => e.target.dataset?.view && showView(e.target.dataset.view));
$('peopleRefresh').addEventListener('click', loadPeople);
$('contactsSync').addEventListener('click', async () => {
  const b = $('contactsSync');
  b.disabled = true;
  b.textContent = 'Trayendo nombres…';
  const res = await fetch('/api/contacts/sync', { method: 'POST' });
  const out = await res.json().catch(() => ({}));
  b.disabled = false;
  b.textContent = 'Traer nombres de la agenda';
  if (!res.ok) return alert(`No se pudieron traer los nombres: ${out.error ?? res.status}`);
  // Los nombres se guardan con un segundo de retraso
  setTimeout(loadPeople, 1500);
  alert(`Se recibieron ${num(out.received)} contactos de la agenda.`);
});
for (const id of ['peopleFilter', 'groupFilter', 'pendingOnly']) $(id).addEventListener('input', renderPeople);
