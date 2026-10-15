import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { pickJid, rememberName } from './people.js';

const FILE = 'data/messages.json';
// Se conservan los mensajes de los ultimos 30 dias, con un tope por grupo
const RETENTION_SECS = 30 * 86400;
const MAX_PER_CHAT = 5000;
// Mensajes que se envian a la interfaz al abrir un grupo
const MAX_SHOWN = 500;

// jid del grupo -> mensajes ordenados por fecha
const chats = new Map();
let repaired = false;
let timer = null;

try {
  const saved = JSON.parse(readFileSync(FILE, 'utf8'));
  for (const [jid, msgs] of Object.entries(saved)) chats.set(jid, msgs.map(repairReactions));
  if (repaired) setTimeout(persist, 0);
} catch {
  // primera ejecucion: sin datos previos
}

// Escribe en un archivo temporal y lo renombra, para no dejar el archivo a medias si el proceso se detiene
function writeNow() {
  clearTimeout(timer);
  timer = null;
  mkdirSync('data', { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(Object.fromEntries(chats)));
  renameSync(`${FILE}.tmp`, FILE);
}

// Reparacion: reacciones del historial guardadas con solo la parte baja de la hora (antes de longToMs).
// Se reconstruye la parte alta tomando la hora mas cercana posterior al mensaje (el ciclo es de ~49 dias).
function repairReactions(m) {
  if (!m.reactions?.some((r) => r.ts < 1e9)) return m;
  repaired = true;
  for (const r of m.reactions) {
    if (r.ts >= 1e9) continue;
    const low = Math.round(r.ts * 1000) >>> 0;
    let ms = Math.round((m.ts * 1000 - low) / 2 ** 32) * 2 ** 32 + low;
    if (ms < m.ts * 1000 - 60_000 && ms + 2 ** 32 <= Date.now()) ms += 2 ** 32;
    r.ts = ms / 1000;
  }
  return m;
}

function persist() {
  clearTimeout(timer);
  timer = setTimeout(writeNow, 1000);
}

// Guarda de inmediato si hay cambios pendientes (al apagar el servidor)
export function flush() {
  if (timer) writeNow();
}

const unwrap = (message) => message?.ephemeralMessage?.message ?? message?.viewOnceMessage?.message ?? message;

function describe(message) {
  const m = unwrap(message);
  if (!m) return null;
  const text =
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption;
  if (text) return text;
  if (m.imageMessage) return '[imagen]';
  if (m.videoMessage) return '[video]';
  if (m.audioMessage) return '[audio]';
  if (m.documentMessage) return `[documento] ${m.documentMessage.fileName ?? ''}`.trim();
  if (m.stickerMessage) return '[sticker]';
  if (m.reactionMessage || m.protocolMessage || m.senderKeyDistributionMessage) return null;
  return '[otro tipo de mensaje]';
}

// Tipo de archivo del mensaje (para saber si una imagen con texto es imagen)
function mediaKind(message) {
  const m = unwrap(message);
  if (m?.imageMessage) return 'image';
  if (m?.videoMessage) return 'video';
  if (m?.documentMessage) return 'document';
  if (m?.audioMessage) return 'audio';
  return undefined;
}

// Guarda un mensaje de grupo de Baileys; ignora los que no son de grupo o no tienen contenido.
// Milisegundos de un numero grande de WhatsApp (Long de protobuf: { low, high }) o de un numero normal
export const longToMs = (v) => {
  if (v == null) return NaN;
  if (typeof v === 'object') return typeof v.toNumber === 'function' ? v.toNumber() : (v.high >>> 0) * 2 ** 32 + (v.low >>> 0);
  return Number(v);
};

const senderOf = (key, participant) => (key?.fromMe ? 'me' : pickJid(key?.participant, key?.participantAlt, participant));
const tsOf = (msg) => Number(msg.messageTimestamp?.low ?? msg.messageTimestamp) || 0;

// Marca un mensaje como eliminado por quien lo envio ("eliminar para todos"); conserva la hora mas temprana
export function markDeleted(jid, id, ts = Date.now() / 1000) {
  const m = chats.get(jid)?.find((x) => x.id === id);
  if (!m || (m.deletedAt && m.deletedAt <= ts)) return;
  m.deletedAt = ts;
  persist();
}

// Guarda una reaccion (emoji) sobre un mensaje: quien reacciono y cuando (la primera de cada persona)
export function addReaction(jid, targetId, sender, ts, emoji) {
  if (!emoji || !sender) return;
  const m = chats.get(jid)?.find((x) => x.id === targetId);
  if (!m) return;
  m.reactions ??= [];
  if (m.reactions.some((r) => r.sender === sender)) return;
  m.reactions.push({ sender, ts });
  persist();
}

export function addMessage(msg) {
  const jid = msg.key?.remoteJid;
  if (!jid?.endsWith('@g.us')) return;
  const content = unwrap(msg.message);
  // Mensaje eliminado para todos: se marca el original
  if (content?.protocolMessage?.type === 0 && content.protocolMessage.key?.id) {
    markDeleted(jid, content.protocolMessage.key.id, tsOf(msg) || undefined);
    return;
  }
  // Reaccion: se guarda en el mensaje al que reaccionaron
  if (content?.reactionMessage) {
    const r = content.reactionMessage;
    addReaction(jid, r.key?.id, senderOf(msg.key, msg.participant), tsOf(msg) || longToMs(r.senderTimestampMs) / 1000, r.text);
    return;
  }
  const text = describe(msg.message);
  if (!text) return;

  const list = chats.get(jid) ?? [];
  if (list.some((m) => m.id === msg.key.id)) return;
  // Quien envia: 'me' para la cuenta conectada; si no, su numero o id interno
  const sender = senderOf(msg.key, msg.participant);
  if (!msg.key.fromMe) rememberName(sender, { push: msg.pushName });
  // Mensaje al que responde (cuando se usa "responder" en WhatsApp)
  const ctx = Object.values(unwrap(msg.message) ?? {}).find((v) => v?.contextInfo)?.contextInfo;
  list.push({
    id: msg.key.id,
    from: msg.key.fromMe ? 'yo' : (msg.pushName || msg.key.participant?.split('@')[0] || '?'),
    fromMe: !!msg.key.fromMe,
    sender,
    quotedId: ctx?.stanzaId || undefined,
    // Personas arrobadas en el mensaje (@)
    mentions: ctx?.mentionedJid?.length ? ctx.mentionedJid : undefined,
    text,
    kind: mediaKind(msg.message),
    ts: tsOf(msg),
  });
  list.sort((a, b) => a.ts - b.ts);
  const cutoff = Date.now() / 1000 - RETENTION_SECS;
  chats.set(jid, list.filter((m) => m.ts >= cutoff).slice(-MAX_PER_CHAT));
  saveHistoryExtras(jid, msg);
  persist();
}

// Reacciones que trae un mensaje del historial (WhatsApp las incluye en cada mensaje)
function saveHistoryExtras(jid, msg) {
  for (const r of msg.reactions ?? []) {
    const ts = longToMs(r.senderTimestampMs) / 1000;
    addReaction(jid, msg.key.id, senderOf(r.key, r.key?.participant), ts || tsOf(msg), r.text);
  }
}

/*
 * Mensaje que llega del historial y que ya estaba guardado: agrega sus reacciones y, si aparece
 * eliminado (stub REVOKE = 1), lo marca. El historial no dice a que hora se elimino; se toma como
 * eliminado al momento, es decir, antes de cualquier respuesta. Devuelve false si no estaba guardado.
 */
export function mergeHistory(msg) {
  const jid = msg.key?.remoteJid;
  if (!jid?.endsWith('@g.us')) return false;
  const existing = chats.get(jid)?.find((m) => m.id === msg.key.id);
  if (!existing) return false;
  saveHistoryExtras(jid, msg);
  if (msg.messageStubType === 1) markDeleted(jid, msg.key.id, existing.ts);
  return true;
}

export const allChats = () => chats;

export const getMessages = (jid) => (chats.get(jid) ?? []).slice(-MAX_SHOWN);

export function getStats(jid) {
  const list = chats.get(jid) ?? [];
  const now = Date.now() / 1000;
  const since = (secs) => list.filter((m) => m.ts >= now - secs).length;
  return {
    messageCount: list.length,
    lastMessageAt: list.at(-1)?.ts ?? null,
    messages24h: since(86400),
    messages7d: since(7 * 86400),
  };
}
