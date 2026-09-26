import { clientOf, typeOf } from './clients.js';
import { getStats } from './store.js';
import { getSocket, getState } from './whatsapp.js';

// Devuelve los grupos en los que participa la cuenta conectada.
export async function listGroups() {
  const sock = getSocket();
  if (!sock || getState().status !== 'connected') return [];

  const groups = await sock.groupFetchAllParticipating();
  return Object.values(groups)
    .map((g) => ({
      id: g.id,
      name: g.subject,
      client: clientOf(g.subject),
      type: typeOf(g.subject),
      participants: g.participants.length,
      ...getStats(g.id),
      createdAt: g.creation ? new Date(g.creation * 1000).toISOString() : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}
