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

// Guarda un mensaje de grupo de Baileys; ignora los que no son de grupo o no tienen contenido.
export function addMessage(msg) {
  const jid = msg.key?.remoteJid;
  if (!jid?.endsWith('@g.us')) return;
  const text = describe(msg.message);
  if (!text) return;

  const list = chats.get(jid) ?? [];
  if (list.some((m) => m.id === msg.key.id)) return;
  // Quien envia: 'me' para la cuenta conectada; si no, su numero o id interno
  const sender = msg.key.fromMe ? 'me' : pickJid(msg.key.participant, msg.key.participantAlt, msg.participant);
  if (!msg.key.fromMe) rememberName(sender, { push: msg.pushName });
  // Mensaje al que responde (cuando se usa "responder" en WhatsApp)
  const ctx = Object.values(unwrap(msg.message) ?? {}).find((v) => v?.contextInfo)?.contextInfo;
  list.push({
    id: msg.key.id,
    from: msg.key.fromMe ? 'yo' : (msg.pushName || msg.key.participant?.split('@')[0] || '?'),
    fromMe: !!msg.key.fromMe,
    sender,
    quotedId: ctx?.stanzaId || undefined,
    text,
    ts: Number(msg.messageTimestamp?.low ?? msg.messageTimestamp) || 0,
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
