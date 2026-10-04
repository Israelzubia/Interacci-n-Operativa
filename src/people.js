import { isLidUser, isPnUser, jidNormalizedUser } from '@whiskeysockets/baileys';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const FILE = 'data/people.json';
export const ROLES = ['Equipo', 'Cliente', 'Proveedor'];

// roles: jid -> rol confirmado por el usuario
// names: jid -> { custom: nombre escrito a mano, contact: nombre en la agenda, push: nombre que la persona se puso }
const saved = { roles: {}, names: {} };
let timer = null;

try {
  Object.assign(saved, JSON.parse(readFileSync(FILE, 'utf8')));
} catch {
  // primera ejecucion: sin datos previos
}

function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    mkdirSync('data', { recursive: true });
    writeFileSync(FILE, JSON.stringify(saved));
  }, 1000);
}

// Prefiere el numero de telefono sobre el id interno (@lid) cuando vienen ambos
export function pickJid(...jids) {
  return jids.find(isPnUser) ?? jids.find(Boolean) ?? null;
}

export function rememberName(jid, { contact, push } = {}) {
  if (!jid || (!contact && !push)) return;
  const key = jidNormalizedUser(jid);
  const prev = saved.names[key] ?? {};
  const next = { ...prev, contact: contact || prev.contact, push: push || prev.push };
  if (next.contact === prev.contact && next.push === prev.push) return;
  saved.names[key] = next;
  persist();
}

// Nombre escrito a mano; tiene prioridad sobre la agenda y WhatsApp. Vacio lo quita.
export function setName(jid, name) {
  if (!jid) throw new Error('Falta la persona');
  const custom = String(name ?? '').trim().slice(0, 80);
  const { custom: _old, ...rest } = saved.names[jid] ?? {};
  saved.names[jid] = custom ? { ...rest, custom } : rest;
  persist();
}

export function setRole(jid, role) {
  if (!jid) throw new Error('Falta la persona');
  if (role && !ROLES.includes(role)) throw new Error(`Rol no valido: ${role}`);
  if (role) saved.roles[jid] = role;
  else delete saved.roles[jid];
  persist();
}

// Traduce ids internos (@lid) al numero de telefono cuando WhatsApp ya compartio la relacion
export function makeResolver(sock) {
  const cache = new Map();
  return async (jid) => {
    if (!jid) return null;
    const norm = jidNormalizedUser(jid);
    if (!isLidUser(norm)) return norm;
    if (!cache.has(norm)) {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID(norm).catch(() => null);
      cache.set(norm, pn ? jidNormalizedUser(pn) : norm);
    }
    return cache.get(norm);
  };
}

// Sugerencia de rol segun los tipos de grupo donde participa la persona
function suggest(p) {
  if (p.isMe || p.types.has('Interno')) return 'Equipo';
  if (p.types.has('Proveedores') && !p.types.has('Clientes')) return 'Proveedor';
  if (p.types.has('Clientes') && !p.types.has('Proveedores')) return 'Cliente';
  return null;
}

// Personas confirmadas como Equipo, con su jid ya traducido a numero
export async function teamJids(resolve) {
  const jids = Object.entries(saved.roles).filter(([, r]) => r === 'Equipo').map(([jid]) => jid);
  return new Set(await Promise.all(jids.map(resolve)));
}

export const displayName = (jid) => nameOf(jid);

function nameOf(...jids) {
  for (const jid of jids) {
    const n = saved.names[jid];
    if (n?.custom || n?.contact || n?.push) return n.custom || n.contact || n.push;
  }
  return null;
}

// Arma el directorio a partir de los integrantes de los grupos y de quien ha escrito
export async function listPeople(sock, groups, chats) {
  const resolve = makeResolver(sock);
  const me = await resolve(sock.user?.id);
  const people = new Map();
  const get = (jid) => {
    if (!people.has(jid)) {
      people.set(jid, { jid, isMe: jid === me, groups: [], types: new Set(), clients: new Map(), messages: 0, lastMessageAt: null, aliases: new Set() });
    }
    return people.get(jid);
  };

  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const g of groups) {
    for (const part of g.participants) {
      const raw = pickJid(part.phoneNumber, part.id);
      const p = get(await resolve(raw));
      p.aliases.add(jidNormalizedUser(part.id));
      p.groups.push(g.name);
      p.types.add(g.type);
      p.clients.set(g.client, (p.clients.get(g.client) ?? 0) + 1);
    }
  }

  for (const [chatId, msgs] of chats) {
    if (!byId.has(chatId)) continue;
    for (const m of msgs) {
      if (!m.sender) continue;
      const p = get(m.sender === 'me' ? me : await resolve(m.sender));
      p.messages += 1;
      p.lastMessageAt = Math.max(p.lastMessageAt ?? 0, m.ts);
      if (m.from && m.from !== 'yo') p.pushFallback = m.from;
    }
  }

  return [...people.values()]
    .map((p) => {
      const suggested = suggest(p);
      const confirmed = saved.roles[p.jid] ?? null;
      return {
        jid: p.jid,
        name: nameOf(p.jid, ...p.aliases) ?? p.pushFallback ?? null,
        customName: saved.names[p.jid]?.custom ?? null,
        phone: isPnUser(p.jid) ? `+${p.jid.split('@')[0]}` : null,
        isMe: p.isMe,
        groupCount: p.groups.length,
        groups: p.groups.sort((a, b) => a.localeCompare(b, 'es')),
        types: [...p.types],
        clients: [...p.clients.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c),
        messages: p.messages,
        lastMessageAt: p.lastMessageAt,
        suggested,
        role: confirmed ?? suggested,
        confirmed: !!confirmed,
      };
    })
    .sort((a, b) => b.messages - a.messages || b.groupCount - a.groupCount);
}
