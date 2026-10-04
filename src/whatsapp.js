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

// Vuelve a pedir a WhatsApp la agenda del telefono (coleccion de app state donde viven los contactos)
// desde cero, para guardar el nombre con el que cada persona esta registrada. No requiere volver a vincular.
const CONTACTS_COLLECTION = 'critical_unblock_low';
export async function syncContacts() {
  if (!sock || state.status !== 'connected') throw new Error('WhatsApp no está conectado');
  const { keys } = sock.authState;
  const saved = await keys.get('app-state-sync-version', [CONTACTS_COLLECTION]);
  let received = 0;
  const count = (contacts) => (received += contacts.filter((c) => c.name).length);
  sock.ev.on('contacts.upsert', count);
  try {
    await keys.set({ 'app-state-sync-version': { [CONTACTS_COLLECTION]: null } });
    await sock.resyncAppState([CONTACTS_COLLECTION], true);
  } catch (err) {
    // Si falla, deja la version como estaba
    await keys.set({ 'app-state-sync-version': { [CONTACTS_COLLECTION]: saved[CONTACTS_COLLECTION] ?? null } });
    throw err;
  } finally {
    sock.ev.off('contacts.upsert', count);
  }
  return { received };
}

export async function logout() {
  await sock?.logout().catch(() => {});
  state.status = 'disconnected';
  state.qr = null;
  state.user = null;
}
