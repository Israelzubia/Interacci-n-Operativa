import { accountOf, typeOfGroup } from './accounts.js';
import { clientOf, typeOf } from './clients.js';
import { getStats } from './store.js';
import { getSocket, getState } from './whatsapp.js';

// WhatsApp limita cuantas veces se puede pedir la lista de grupos ("rate-overlimit"):
// se guarda 5 minutos en memoria, se comparte entre peticiones simultaneas y, si WhatsApp
// rechaza la consulta, se usa la ultima lista obtenida.
const CACHE_MS = 5 * 60 * 1000;
let cache = { at: 0, data: null };
let inflight = null;

async function fetchRaw(sock) {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  inflight ??= sock
    .groupFetchAllParticipating()
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .catch((err) => {
      if (cache.data) return cache.data;
      throw err;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// Metadatos de los grupos de la cuenta conectada (con integrantes), clasificados por cliente y tipo.
export async function fetchGroups() {
  const sock = getSocket();
  if (!sock || getState().status !== 'connected') return [];
  const groups = await fetchRaw(sock);
  return Object.values(groups).map((g) => ({
    id: g.id,
    name: g.subject,
    client: clientOf(g.subject),
    // Tipo confirmado a mano o, si no, el sugerido por el nombre
    ...typeOfGroup(g.id, typeOf(g.subject)),
    participants: g.participants,
    creation: g.creation,
  }));
}

// Devuelve los grupos en los que participa la cuenta conectada.
export async function listGroups() {
  return (await fetchGroups())
    .map((g) => ({
      id: g.id,
      name: g.name,
      client: g.client,
      type: g.type,
      typeSuggested: g.typeSuggested,
      typeConfirmed: g.typeConfirmed,
      ...accountOf(g.id, g.client, g.name, g.type),
      participants: g.participants.length,
      ...getStats(g.id),
      createdAt: g.creation ? new Date(g.creation * 1000).toISOString() : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}
