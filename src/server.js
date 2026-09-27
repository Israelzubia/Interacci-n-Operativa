import express from 'express';
import { fileURLToPath } from 'node:url';
import { fetchGroups, listGroups } from './groups.js';
import { listPeople, setRole } from './people.js';
import { allChats, getMessages } from './store.js';
import { connect, getSocket, getState, logout } from './whatsapp.js';

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json());
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));

app.get('/api/status', (_req, res) => res.json(getState()));

app.get('/api/groups', async (_req, res) => {
  try {
    res.json(await listGroups());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/groups/:id/messages', (req, res) => res.json(getMessages(req.params.id)));

app.get('/api/people', async (_req, res) => {
  try {
    if (getState().status !== 'connected') return res.json([]);
    res.json(await listPeople(getSocket(), await fetchGroups(), allChats()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Asigna (o quita, con role null) el rol de una o varias personas
app.post('/api/people/role', (req, res) => {
  try {
    const jids = req.body.jids ?? [req.body.jid];
    for (const jid of jids) setRole(jid, req.body.role ?? null);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
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
