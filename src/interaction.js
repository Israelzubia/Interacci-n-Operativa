import { isPnUser } from '@whiskeysockets/baileys';
import { displayName, makeResolver, teamJids } from './people.js';

// Horario de operacion: todos los dias de 4:00 a 23:59, hora del centro de Mexico (UTC-6, sin horario de verano).
// El tiempo de respuesta solo cuenta los minutos dentro de este horario; la noche no cuenta.
const TZ_OFFSET = -6 * 3600;
const WORK_START = 4 * 3600;
const WORK_END = 24 * 3600;
export const WORK_HOURS = 'Todos los días, 4:00 a 23:59';

// Segundos dentro del horario entre dos instantes (en segundos unix)
function workSeconds(from, to) {
  let total = 0;
  const last = Math.floor((to + TZ_OFFSET) / 86400);
  for (let day = Math.floor((from + TZ_OFFSET) / 86400); day <= last; day++) {
    const start = day * 86400 - TZ_OFFSET;
    const a = Math.max(from, start + WORK_START);
    const b = Math.min(to, start + WORK_END);
    if (b > a) total += b - a;
  }
  return total;
}

// Tiempo maximo aceptable sin respuesta, en minutos
export const MAX_THRESHOLD = 10;

// Hora local (0-23) de un instante
const hourOf = (ts) => Math.floor((((ts + TZ_OFFSET) % 86400) + 86400) % 86400 / 3600);

/*
 * Recorre los mensajes de los grupos con clientes y proveedores y arma "solicitudes":
 * una solicitud empieza con el primer mensaje de la contraparte (cliente o proveedor)
 * despues de que el equipo hablo, y termina con el primer mensaje del equipo.
 * Si el equipo cita un mensaje (responder en WhatsApp), la respuesta se marca como explicita.
 */
function detect(groups, chats, team) {
  const requests = [];
  const teamMsgs = [];
  for (const g of groups) {
    if (g.type === 'Interno') continue;
    const list = chats.get(g.id) ?? [];
    let open = null;
    for (const m of list) {
      if (!m.sender) continue; // mensajes guardados antes de registrar al remitente
      const isTeam = m.sender === 'me' || team.has(m.sender);
      if (isTeam) {
        teamMsgs.push({ g, m });
        if (!open) continue;
        open.answeredAt = m.ts;
        open.responder = m.sender;
        open.explicit = !!m.quotedId && open.ids.has(m.quotedId);
        requests.push(open);
        open = null;
      } else if (!open) {
        if (isAck(m.text)) continue;
        open = { group: g, requester: m.sender, start: m.ts, text: m.text, count: 1, ids: new Set([m.id]) };
      } else {
        open.count += 1;
        open.ids.add(m.id);
      }
    }
    if (open) requests.push(open);
  }
  return { requests, teamMsgs };
}

// Acuses de recibo que no esperan respuesta ("ok", "enterado", un emoji, un sticker)
const ACK = /^(ok(ay|is)?|va|sale|listo|perfecto|enterad[oa]s?|gracias|muchas gracias|de acuerdo|copiado|recibido|excelente|s[ií]|claro|buen d[ií]a|buenas noches|jaja\w*|jeje\w*)[\s!.,👍🙏🏻🏼🏽]*$/i;
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f\s]+$/u;
const isAck = (text) => text === '[sticker]' || EMOJI_ONLY.test(text) || ACK.test(text.trim());

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function summarize(reqs, threshold) {
  const answered = reqs.filter((r) => r.answeredAt);
  const waits = answered.map((r) => r.wait);
  return {
    requests: reqs.length,
    answered: answered.length,
    onTime: answered.filter((r) => r.wait <= threshold).length,
    pending: reqs.filter((r) => !r.answeredAt && r.wait > threshold).length,
    median: median(waits),
    avg: avg(waits),
  };
}

function group(list, key) {
  const map = new Map();
  for (const item of list) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

// Metricas de interaccion del equipo para los ultimos `days` dias; `threshold` en minutos
export async function interactionReport(sock, groups, chats, { days = 7, threshold = MAX_THRESHOLD } = {}) {
  const resolve = makeResolver(sock);
  const me = await resolve(sock.user?.id);
  const team = await teamJids(resolve);
  team.delete(me);

  // Normaliza remitentes (@lid -> numero) antes de detectar
  const normalized = new Map();
  const pushNames = new Map();
  for (const g of groups) {
    const list = chats.get(g.id);
    if (!list || g.type === 'Interno') continue;
    const out = [];
    for (const m of list) {
      if (!m.sender) continue;
      if (m.from && m.from !== 'yo') pushNames.set(m.sender, m.from);
      out.push(m.sender === 'me' || isPnUser(m.sender) ? m : { ...m, sender: await resolve(m.sender) });
    }
    normalized.set(g.id, out);
  }

  const now = Date.now() / 1000;
  const since = now - days * 86400;
  const thr = threshold * 60;
  const { requests, teamMsgs } = detect(groups, normalized, team);
  const reqs = requests
    .filter((r) => r.start >= since)
    .map((r) => ({ ...r, wait: workSeconds(r.start, r.answeredAt ?? now) }));
  const recentTeam = teamMsgs.filter(({ m }) => m.ts >= since);

  const nameOf = (jid) =>
    jid === 'me'
      ? (displayName(me) ? `${displayName(me)} (tú)` : 'Tú')
      : displayName(jid) ?? pushNames.get(jid) ?? (isPnUser(jid) ? `+${jid.split('@')[0]}` : 'Sin nombre');
  const counterpart = (r) => (r.group.type === 'Proveedores' ? 'Proveedor' : 'Cliente');

  // Por cliente y tipo de grupo
  const byClient = [...group(reqs, (r) => `${r.group.client}|${r.group.type}`)].map(([k, list]) => {
    const [client, type] = k.split('|');
    return { client, type, groups: new Set(list.map((r) => r.group.id)).size, ...summarize(list, thr) };
  });

  // Por persona del equipo
  const responses = reqs.filter((r) => r.answeredAt);
  const memberKeys = new Set(['me', ...team]);
  const byMember = [...memberKeys]
    .map((jid) => {
      const mine = responses.filter((r) => r.responder === jid);
      const msgs = recentTeam.filter(({ m }) => m.sender === jid);
      const waits = mine.map((r) => r.wait);
      return {
        jid,
        name: nameOf(jid),
        isMe: jid === 'me',
        responses: mine.length,
        explicit: mine.filter((r) => r.explicit).length,
        median: median(waits),
        avg: avg(waits),
        onTime: mine.filter((r) => r.wait <= thr).length,
        // Respuestas por rango del semaforo: < 5 min, 5 a 9 min, 10 min o mas
        fast: mine.filter((r) => r.wait < 300).length,
        mid: mine.filter((r) => r.wait >= 300 && r.wait < 600).length,
        slow: mine.filter((r) => r.wait >= 600).length,
        messages: msgs.length,
        groups: new Set(msgs.map(({ g }) => g.id)).size,
        clients: Object.fromEntries([...group(mine, (r) => r.group.client)].map(([c, l]) => [c, l.length])),
      };
    })
    .filter((p) => p.messages || p.responses)
    .sort((a, b) => b.responses - a.responses || b.messages - a.messages);

  // Mensajes de la contraparte y del equipo por hora del dia
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, counterpart: 0, team: 0 }));
  for (const list of normalized.values()) {
    for (const m of list) {
      if (m.ts < since) continue;
      const isTeam = m.sender === 'me' || team.has(m.sender);
      hours[hourOf(m.ts)][isTeam ? 'team' : 'counterpart'] += 1;
    }
  }

  // Solicitudes abiertas que ya pasaron el umbral
  const pending = reqs
    .filter((r) => !r.answeredAt && r.wait > thr)
    .sort((a, b) => b.wait - a.wait)
    .slice(0, 100)
    .map((r) => ({
      groupId: r.group.id,
      group: r.group.name,
      client: r.group.client,
      kind: counterpart(r),
      requester: nameOf(r.requester),
      text: r.text,
      count: r.count,
      start: r.start,
      wait: r.wait,
    }));

  // Respuestas mas lentas, para revisar casos
  const slowest = [...responses]
    .sort((a, b) => b.wait - a.wait)
    .slice(0, 20)
    .map((r) => ({
      group: r.group.name,
      client: r.group.client,
      kind: counterpart(r),
      requester: nameOf(r.requester),
      responder: nameOf(r.responder),
      text: r.text,
      start: r.start,
      answeredAt: r.answeredAt,
      wait: r.wait,
    }));

  const withSender = [...normalized.values()].flat();
  return {
    days,
    threshold,
    workHours: WORK_HOURS,
    dataSince: withSender.length ? Math.min(...withSender.map((m) => m.ts)) : null,
    teamSize: memberKeys.size,
    totals: {
      ...summarize(reqs, thr),
      byKind: {
        Cliente: summarize(reqs.filter((r) => counterpart(r) === 'Cliente'), thr),
        Proveedor: summarize(reqs.filter((r) => counterpart(r) === 'Proveedor'), thr),
      },
      teamMessages: recentTeam.length,
    },
    byClient: byClient.sort((a, b) => b.requests - a.requests),
    byMember,
    hours,
    pending,
    slowest,
  };
}
