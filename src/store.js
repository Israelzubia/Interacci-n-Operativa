import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const FILE = 'data/messages.json';
const MAX_PER_CHAT = 500;

// jid del grupo -> mensajes ordenados por fecha
const chats = new Map();
let timer = null;

try {
  const saved = JSON.parse(readFileSync(FILE, 'utf8'));
  for (const [jid, msgs] of Object.entries(saved)) chats.set(jid, msgs);
} catch {
  // primera ejecucion: sin datos previos
}

function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    mkdirSync('data', { recursive: true });
    writeFileSync(FILE, JSON.stringify(Object.fromEntries(chats)));
  }, 1000);
}

function describe(message) {
  if (!message) return null;
  const m = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message;
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
  list.push({
    id: msg.key.id,
    from: msg.key.fromMe ? 'yo' : (msg.pushName || msg.key.participant?.split('@')[0] || '?'),
    fromMe: !!msg.key.fromMe,
    text,
    ts: Number(msg.messageTimestamp?.low ?? msg.messageTimestamp) || 0,
  });
  list.sort((a, b) => a.ts - b.ts);
  chats.set(jid, list.slice(-MAX_PER_CHAT));
  persist();
}

export const getMessages = (jid) => chats.get(jid) ?? [];

export function getStats(jid) {
  const list = chats.get(jid) ?? [];
  return { messageCount: list.length, lastMessageAt: list.at(-1)?.ts ?? null };
}
