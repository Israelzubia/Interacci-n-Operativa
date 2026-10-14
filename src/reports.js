// Regla: en los grupos de proveedores de MELI, Monitoreo debe mandar el reporte de rutas (una imagen
// con la palabra "avance") cada 2 horas. El horario es relativo a cada grupo: el primer reporte vence
// 2 h despues del primer mensaje del dia, nunca antes de las 10:00, y luego cada 2 h hasta las 22:00.
const TZ_OFFSET = -6 * 3600;
const DAY_START = 4 * 3600;
export const REPORT_RULE = {
  every: 2 * 3600, // cada 2 horas
  tolerance: 15 * 60, // a tiempo si llega hasta 15 min despues de la hora
  early: 30 * 60, // un reporte hasta 30 min antes de la hora cuenta para esa hora
  firstDue: 10 * 3600, // primer reporte del dia: no antes de las 10:00
  lastDue: 22 * 3600, // ultimo reporte del dia: 22:00
  keyword: 'avance',
  // Dia desde el que se mide la regla (se anuncio al equipo el 11 oct 2026)
  startDay: '2026-10-12',
};

// Reporte valido: imagen cuyo texto dice "avance"
const KEYWORD = /avance/i;
const isReport = (m) => m.kind === 'image' && KEYWORD.test(m.text);

const dayOf = (ts) => Math.floor((ts + TZ_OFFSET) / 86400);
const dayStart = (day) => day * 86400 - TZ_OFFSET;
const dayKey = (day) => new Date(day * 86400 * 1000).toISOString().slice(0, 10);

// Reportes de un grupo en un dia: horarios que vencen y la imagen de Monitoreo que cumple cada uno
function slotsForDay(list, day, isMonitor, now) {
  const start0 = dayStart(day);
  const first = list.find((m) => m.ts >= start0 + DAY_START && m.ts < start0 + 86400);
  if (!first) return null;
  const images = list.filter((m) => isReport(m) && isMonitor(m.sender) && m.ts >= first.ts && m.ts < start0 + 86400);
  const slots = [];
  const firstDue = Math.max(first.ts + REPORT_RULE.every, start0 + REPORT_RULE.firstDue);
  for (let due = firstDue; due <= start0 + REPORT_RULE.lastDue; due += REPORT_RULE.every) {
    // Ventana de cada reporte: desde 30 min antes de la hora hasta 30 min antes del siguiente
    const from = due - REPORT_RULE.early;
    const to = due + REPORT_RULE.every - REPORT_RULE.early;
    const hit = images.find((m) => m.ts >= from && m.ts < to);
    let status;
    if (hit) status = hit.ts <= due + REPORT_RULE.tolerance ? 'onTime' : 'late';
    else if (now < due + REPORT_RULE.tolerance) status = 'upcoming';
    else if (now < to) status = 'overdue';
    else status = 'missed';
    slots.push({ due, status, sentAt: hit?.ts ?? null, sender: hit?.sender ?? null, delay: hit ? Math.max(0, hit.ts - due) : null });
  }
  return { start: first.ts, slots };
}

const ratio = (s) => {
  const evaluated = s.onTime + s.late + s.missed;
  return evaluated ? s.onTime / evaluated : null;
};

function tally(slots) {
  const count = (st) => slots.filter((s) => s.status === st).length;
  const late = slots.filter((s) => s.status === 'late');
  const t = { onTime: count('onTime'), late: count('late'), missed: count('missed') + count('overdue'), upcoming: count('upcoming') };
  return { ...t, compliance: ratio(t), avgDelay: late.length ? late.reduce((a, s) => a + s.delay, 0) / late.length : null };
}

export function reportRule({ groups, normalized, acctOf, isMonitor, nameOf, since, now }) {
  const ruleGroups = groups.filter((g) => g.type === 'Proveedores' && acctOf(g) === 'MELI');
  const today = dayOf(now);
  const ruleStart = dayOf(Date.parse(`${REPORT_RULE.startDay}T12:00:00Z`) / 1000);
  const firstDay = Math.max(dayOf(since), ruleStart);
  const all = [];
  const byGroup = ruleGroups.map((g) => {
    const list = normalized.get(g.id) ?? [];
    const days = [];
    for (let day = firstDay; day <= today; day++) {
      const r = slotsForDay(list, day, isMonitor, now);
      if (!r) continue;
      const slots = r.slots.filter((s) => s.due >= since);
      days.push({ day: dayKey(day), start: r.start, slots });
      for (const s of slots) all.push({ ...s, group: g, day: dayKey(day) });
    }
    const slots = days.flatMap((d) => d.slots);
    const todayDay = days.find((d) => d.day === dayKey(today));
    return {
      id: g.id,
      name: g.name,
      ...tally(slots),
      today: todayDay
        ? {
            start: todayDay.start,
            slots: todayDay.slots.map((s) => ({ ...s, sender: s.sender ? nameOf(s.sender) : null })),
          }
        : null,
      // Detalle de cada dia del periodo (para ver el dia que se elija)
      days: Object.fromEntries(
        days.map((d) => [
          d.day,
          { start: d.start, ...tally(d.slots), slots: d.slots.map((s) => ({ ...s, sender: s.sender ? nameOf(s.sender) : null })) },
        ]),
      ),
      // Ultimos casos omitidos o tarde, para revisar
      issues: days
        .flatMap((d) => d.slots.filter((s) => s.status === 'missed' || s.status === 'late').map((s) => ({ ...s, day: d.day, sender: s.sender ? nameOf(s.sender) : null })))
        .sort((a, b) => b.due - a.due)
        .slice(0, 12),
    };
  });
  // Por persona de Monitoreo que mando reportes
  const sent = all.filter((s) => s.sender);
  const people = new Map();
  for (const s of sent) {
    const p = people.get(s.sender) ?? { jid: s.sender, name: nameOf(s.sender), reports: 0, onTime: 0, late: 0, groups: new Set() };
    p.reports += 1;
    if (s.status === 'onTime') p.onTime += 1;
    else p.late += 1;
    p.groups.add(s.group.name);
    people.set(s.sender, p);
  }
  // Cumplimiento por dia
  const byDay = new Map();
  for (const s of all) {
    if (!byDay.has(s.day)) byDay.set(s.day, []);
    byDay.get(s.day).push(s);
  }
  return {
    rule: { ...REPORT_RULE },
    started: today >= ruleStart,
    groups: ruleGroups.length,
    totals: tally(all),
    byGroup: byGroup.sort((a, b) => (a.compliance ?? 2) - (b.compliance ?? 2)),
    byMember: [...people.values()].map((p) => ({ ...p, groups: [...p.groups] })).sort((a, b) => b.reports - a.reports),
    byDay: [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => ({ day, ...tally(list) })),
  };
}
