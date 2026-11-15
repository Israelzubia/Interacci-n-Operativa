import { isLidUser, jidNormalizedUser } from '@whiskeysockets/baileys';
import { invalidateGroups } from './groups.js';
import { makeResolver, pickJid } from './people.js';

const PAUSE_MS = 1500; // pausa entre grupos, para no saturar a WhatsApp

/*
 * Saca a una persona de los grupos indicados donde la cuenta conectada es administradora.
 * Con dryRun solo revisa que se pueda, sin sacar a nadie. Devuelve el resultado de cada grupo.
 */
export async function removeFromGroups(sock, groups, personJid, groupIds, { dryRun = false } = {}) {
  const resolve = makeResolver(sock);
  const me = await resolve(sock.user?.id);
  const myLid = sock.user?.lid ? jidNormalizedUser(sock.user.lid) : null;
  const byId = new Map(groups.map((g) => [g.id, g]));
  const results = [];
  for (const id of groupIds) {
    const g = byId.get(id);
    if (!g) {
      results.push({ id, name: '(grupo no disponible)', status: 'not-found' });
      continue;
    }
    // Participante de la cuenta propia y de la persona, traducidos a numero
    let mine = null;
    let target = null;
    for (const part of g.participants) {
      const jid = await resolve(pickJid(part.phoneNumber, part.id));
      if (jid === me || (myLid && jidNormalizedUser(part.id) === myLid)) mine = part;
      if (jid === personJid || jidNormalizedUser(part.id) === personJid) target = part;
    }
    const base = { id, name: g.name };
    if (!target) results.push({ ...base, status: 'not-member' });
    else if (!mine?.admin) results.push({ ...base, status: 'not-admin' });
    else if (target.admin === 'superadmin') results.push({ ...base, status: 'owner' });
    else if (dryRun) results.push({ ...base, status: 'ok-dry-run' });
    else {
      try {
        // Se usa el id con el que WhatsApp tiene registrada a la persona en ese grupo
        const jid = isLidUser(target.id) ? target.id : jidNormalizedUser(target.phoneNumber ?? target.id);
        const [r] = await sock.groupParticipantsUpdate(id, [jid], 'remove');
        results.push({ ...base, status: r?.status === '200' ? 'removed' : 'error', detail: r?.status });
      } catch (err) {
        results.push({ ...base, status: 'error', detail: err.message });
      }
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  }
  if (!dryRun) invalidateGroups();
  return results;
}
