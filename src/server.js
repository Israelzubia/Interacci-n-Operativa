import express from 'express';
import { fileURLToPath } from 'node:url';
import { listGroups } from './groups.js';
import { connect, getState, logout } from './whatsapp.js';

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));

app.get('/api/status', (_req, res) => res.json(getState()));

app.get('/api/groups', async (_req, res) => {
  try {
    res.json(await listGroups());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/connect', async (_req, res) => {
  if (getState().status === 'disconnected') await connect();
  res.json(getState());
});

app.post('/api/logout', async (_req, res) => {
  await logout();
  res.json(getState());
});

// Solo escucha en local: la sesion de WhatsApp no debe exponerse a la red.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Plataforma en http://localhost:${PORT}`);
  connect().catch((err) => console.error('Error al conectar con WhatsApp:', err));
});
