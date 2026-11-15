// Vista Limpieza: busca a una persona por nombre o numero y muestra todos los grupos donde esta.
// Usa $, num, groups (app.js), el, goToGroup (interaction.js) y people, loadPeople (people.js).
const MAX_PEOPLE = 15;

// Texto sin acentos y en minusculas, para buscar "jose" y encontrar "José"
const plain = (t) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function openCleanup() {
  if (!peopleLoaded) {
    $('cleanupNote').textContent = 'Cargando personas…';
    await loadPeople();
  }
  renderCleanup();
  $('cleanupQuery').focus();
}

function findPeople(q) {
  const text = plain(q.trim());
  const digits = q.replace(/\D/g, '');
  if (text.length < 2 && digits.length < 4) return [];
  return people
    .filter((p) => p.memberships?.length)
    .filter((p) => (digits.length >= 4 ? (p.phone ?? '').replace(/\D/g, '').includes(digits) : plain(p.name).includes(text)))
    .sort((a, b) => b.memberships.length - a.memberships.length);
}

function copyList(p, list) {
  const lines = [`${p.name ?? 'Sin nombre'} ${p.phone ?? ''} · ${list.length} grupos`, ...list.map((g) => `- ${g.name}`)];
  navigator.clipboard?.writeText(lines.join('\n')).then(
    () => alert('Lista de grupos copiada'),
    () => alert('No se pudo copiar'),
  );
}

function personResult(p, myAdmin) {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const list = p.memberships
    .map((m) => ({ ...(byId.get(m.id) ?? { id: m.id, name: '(grupo no disponible)' }), personAdmin: m.admin, iAmAdmin: myAdmin.has(m.id) }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'es'));

  const box = el('div', null, 'cl-person');
  const head = el('div', null, 'cl-head');
  const who = el('span');
  who.append(el('span', `${p.name ?? 'Sin nombre'}${p.isMe ? ' (tú)' : ''}`, 'who'), el('span', p.phone ?? '', 'phone'));
  if (p.role) who.append(el('span', p.role, 'chip'));
  if (p.area && p.role === 'Equipo') who.append(el('span', p.area, 'chip'));
  const right = el('span');
  const copy = el('button', 'Copiar lista');
  copy.addEventListener('click', () => copyList(p, list));
  right.append(el('span', `Está en ${num(list.length)} ${list.length === 1 ? 'grupo' : 'grupos'} `, 'muted'), copy);
  // Sacarla de todos los grupos donde la cuenta conectada es administradora
  const removable = list.filter((g) => g.iAmAdmin);
  if (!p.isMe && removable.length) {
    const out = el('button', `Sacar de ${num(removable.length)} ${removable.length === 1 ? 'grupo' : 'grupos'} donde eres admin`, 'danger');
    out.style.marginLeft = '6px';
    out.addEventListener('click', () => removePerson(p, removable, out));
    right.append(out);
  }
  head.append(who, right);

  const table = el('table', null, 'data cl-groups');
  const hr = el('tr');
  for (const [label, n] of [['Grupo'], ['Cuenta'], ['Tipo'], ['Cliente'], ['Integrantes', 1], ['Administración']]) hr.append(el('th', label, n ? 'num' : ''));
  table.append(hr);
  for (const g of list) {
    const tr = el('tr');
    const name = el('td', g.name, 'g');
    name.title = 'Abrir el grupo';
    name.addEventListener('click', () => goToGroup(g.name, g.id));
    const admin = el('td');
    if (g.personAdmin) admin.append(el('span', 'Es admin', 'cl-badge adm'), ' ');
    if (g.iAmAdmin) admin.append(el('span', 'Tú eres admin', 'cl-badge'));
    tr.append(name, el('td', g.account ?? '–'), el('td', g.type ?? '–'), el('td', g.client ?? '–'), el('td', g.participants != null ? num(g.participants) : '–', 'num'), admin);
    table.append(tr);
  }
  const scroll = el('div', null, 'scroll');
  scroll.append(table);
  box.append(head, scroll);
  return box;
}

const STATUS_TEXT = {
  removed: 'la sacaste',
  'not-member': 'ya no estaba',
  'not-admin': 'ya no eres admin',
  owner: 'es la creadora del grupo, no se puede sacar',
  error: 'WhatsApp no lo permitió',
  'not-found': 'grupo no disponible',
};

async function removePerson(p, list, button) {
  const who = `${p.name ?? 'Sin nombre'} ${p.phone ?? ''}`.trim();
  const ok = confirm(
    `¿Sacar a ${who} de ${list.length} ${list.length === 1 ? 'grupo' : 'grupos'}?\n\n` +
      list.map((g) => `• ${g.name}`).join('\n') +
      '\n\nWhatsApp avisará en cada grupo que la sacaste. Esta acción no se puede deshacer desde aquí.',
  );
  if (!ok) return;
  button.disabled = true;
  button.textContent = `Sacando de ${list.length} grupos…`;
  const res = await fetch('/api/cleanup/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jid: p.jid, groups: list.map((g) => g.id) }),
  });
  const results = await res.json().catch(() => ({ error: 'Respuesta no válida' }));
  if (!res.ok) {
    button.disabled = false;
    button.textContent = 'Reintentar';
    return alert(`No se pudo: ${results.error}`);
  }
  const removed = results.filter((r) => r.status === 'removed').length;
  const others = results.filter((r) => r.status !== 'removed');
  alert(
    `${who}: la sacaste de ${removed} de ${results.length} grupos.` +
      (others.length ? `\n\nNo se sacó de:\n${others.map((r) => `• ${r.name}: ${STATUS_TEXT[r.status] ?? r.status}`).join('\n')}` : ''),
  );
  $('cleanupNote').textContent = 'Actualizando…';
  await loadPeople();
  renderCleanup();
}

function renderCleanup() {
  const q = $('cleanupQuery').value;
  const found = findPeople(q);
  // Grupos donde la cuenta conectada es administradora (ahi se puede sacar a la persona)
  const me = people.find((p) => p.isMe);
  const myAdmin = new Set((me?.memberships ?? []).filter((m) => m.admin).map((m) => m.id));
  if (!q.trim()) {
    $('cleanupNote').textContent = `${num(people.length)} personas en ${num(groups.length)} grupos.`;
  } else if (!found.length) {
    $('cleanupNote').textContent = 'No se encontró a nadie con ese nombre o número en los grupos actuales.';
  } else {
    $('cleanupNote').textContent = `${num(found.length)} ${found.length === 1 ? 'persona encontrada' : 'personas encontradas'}${found.length > MAX_PEOPLE ? `; se muestran las primeras ${MAX_PEOPLE}, escribe más para precisar` : ''}.`;
  }
  $('cleanupResults').replaceChildren(...found.slice(0, MAX_PEOPLE).map((p) => personResult(p, myAdmin)));
}

let cleanupTimer = null;
$('cleanupQuery').addEventListener('input', () => {
  clearTimeout(cleanupTimer);
  cleanupTimer = setTimeout(renderCleanup, 200);
});
$('cleanupRefresh').addEventListener('click', async () => {
  $('cleanupNote').textContent = 'Actualizando…';
  await loadPeople();
  renderCleanup();
});
