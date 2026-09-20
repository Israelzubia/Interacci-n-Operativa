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
      participants: g.participants.length,
      createdAt: g.creation ? new Date(g.creation * 1000).toISOString() : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}
