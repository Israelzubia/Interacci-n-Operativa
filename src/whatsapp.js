import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { rememberName } from './people.js';
import { addMessage } from './store.js';
import { rm } from 'node:fs/promises';
import pino from 'pino';
import QRCode from 'qrcode';

const AUTH_DIR = 'auth';
const logger = pino({ level: 'silent' });

// Estado observable por la interfaz: disconnected | qr | connecting | connected
const state = { status: 'disconnected', qr: null, user: null };
let sock = null;

function safeAdd(msg) {
  try {
    addMessage(msg);
  } catch (err) {
    console.error('Mensaje omitido:', err.message);
  }
}

// Nombre en la agenda del telefono y nombre que la persona se puso en WhatsApp
function learnContact(c) {
  const names = { contact: c.name, push: c.notify };
  for (const jid of [c.id, c.phoneNumber, c.lid]) rememberName(jid, names);
}

export function getState() {
  return { ...state };
}

export function getSocket() {
  return sock;
}

export async function connect() {
  const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  state.status = 'connecting';
  sock = makeWASocket({ version, auth, logger, printQRInTerminal: false, syncFullHistory: true });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messages.upsert', ({ messages }) => messages.forEach(safeAdd));
  sock.ev.on('messaging-history.set', ({ messages, contacts }) => {
    messages.forEach(safeAdd);
    contacts?.forEach(learnContact);
  });
  sock.ev.on('contacts.upsert', (contacts) => contacts.forEach(learnContact));
  sock.ev.on('contacts.update', (contacts) => contacts.forEach(learnContact));

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      state.status = 'qr';
      state.qr = await QRCode.toDataURL(qr, { width: 320, margin: 1 });
    }
    if (connection === 'open') {
      state.status = 'connected';
      state.qr = null;
      state.user = { id: sock.user?.id, name: sock.user?.name };
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      state.user = null;
      state.qr = null;
      if (code === DisconnectReason.loggedOut) {
        state.status = 'disconnected';
        await rm(AUTH_DIR, { recursive: true, force: true });
      } else {
        // Caida transitoria (incluye el reinicio que WhatsApp pide tras escanear el QR)
        await connect();
      }
    }
  });
}

export async function logout() {
  await sock?.logout().catch(() => {});
  state.status = 'disconnected';
  state.qr = null;
  state.user = null;
}
