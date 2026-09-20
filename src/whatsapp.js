import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { rm } from 'node:fs/promises';
import pino from 'pino';
import QRCode from 'qrcode';

const AUTH_DIR = 'auth';
const logger = pino({ level: 'silent' });

// Estado observable por la interfaz: disconnected | qr | connecting | connected
const state = { status: 'disconnected', qr: null, user: null };
let sock = null;

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
  sock = makeWASocket({ version, auth, logger, printQRInTerminal: false });
  sock.ev.on('creds.update', saveCreds);

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
