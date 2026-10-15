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
let timer = null;

try {
  const saved = JSON.parse(readFileSync(FILE, 'utf8'));
  for (const [jid, msgs] of Object.entries(saved)) chats.set(jid, msgs);
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
    addReaction(jid, r.key?.id, senderOf(msg.key, msg.participant), tsOf(msg) || Number(r.senderTimestampMs) / 1000, r.text);
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
  persist();
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
