import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { rememberName } from './people.js';
import { addMessage } from './store.js';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import pino from 'pino';
import QRCode from 'qrcode';

const AUTH_DIR = 'auth';
const logger = pino({ level: 'silent' });

// Estado observable por la interfaz: disconnected | qr | connecting | connected
const state = { status: 'disconnected', qr: null, user: null };
let sock = null;
let connecting = false;
let retryTimer = null;
let attempt = 0;

// Reintenta la conexion con espera creciente (2 s, 4 s, 8 s... hasta 1 min) ante cualquier falla:
// sin internet, WhatsApp caido o un error al arrancar. Nunca se da por vencido.
function scheduleReconnect(delay = Math.min(60_000, 2000 * 2 ** attempt)) {
  clearTimeout(retryTimer);
  attempt += 1;
  state.status = 'connecting';
  retryTimer = setTimeout(connect, delay);
}

function onConnectError(err) {
  console.error(new Date().toISOString(), 'Error al conectar con WhatsApp:', err.message);
  connecting = false;
  scheduleReconnect();
}

// Vigilancia: si hay sesion guardada y la conexion quedo caida, la levanta de nuevo
setInterval(() => {
  if (state.status === 'disconnected' && !connecting && existsSync(`${AUTH_DIR}/creds.json`)) {
    connect();
  }
}, 60_000).unref();

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

// Conecta (o reconecta); cualquier error programa un nuevo intento
export function connect() {
  return openSocket().catch(onConnectError);
}

async function openSocket() {
  if (connecting) return;
  connecting = true;
  clearTimeout(retryTimer);
  // Cierra el socket anterior para no duplicar eventos
  if (sock) {
    sock.ev.removeAllListeners();
    sock.end?.(undefined);
  }
  state.status = 'connecting';
  const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({ version, auth, logger, printQRInTerminal: false, syncFullHistory: true });
  connecting = false;
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
      attempt = 0;
      console.log(new Date().toISOString(), 'WhatsApp conectado');
      state.status = 'connected';
      state.qr = null;
      state.user = { id: sock.user?.id, name: sock.user?.name };
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      state.user = null;
      state.qr = null;
      console.log(new Date().toISOString(), 'WhatsApp desconectado, codigo', code);
      if (code === DisconnectReason.loggedOut) {
        // La sesion se cerro desde el telefono: hay que volver a vincular con QR
        state.status = 'disconnected';
        await rm(AUTH_DIR, { recursive: true, force: true });
      } else {
        // Caida transitoria; tras escanear el QR WhatsApp pide reiniciar de inmediato
        scheduleReconnect(code === DisconnectReason.restartRequired ? 0 : undefined);
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
