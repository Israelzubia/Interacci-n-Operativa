import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

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

// Historico del cumplimiento por dia: los dias ya terminados se guardan en un archivo para que
// sigan disponibles aunque los mensajes se borren (se conservan 30 dias) o cambie el periodo elegido.
const HISTORY_FILE = 'data/report-history.json';
let history = { days: {} };
try {
  history = JSON.parse(readFileSync(HISTORY_FILE, 'utf8'));
} catch {
  // primera ejecucion: sin historico
}

function saveHistory() {
  mkdirSync('data', { recursive: true });
  writeFileSync(`${HISTORY_FILE}.tmp`, JSON.stringify(history));
  renameSync(`${HISTORY_FILE}.tmp`, HISTORY_FILE);
}

const withNames = (slots, nameOf) => slots.map((s) => ({ ...s, sender: s.sender ? nameOf(s.sender) : null }));

export function reportRule({ groups, normalized, acctOf, isMonitor, nameOf, since, now }) {
  const ruleGroups = groups.filter((g) => g.type === 'Proveedores' && acctOf(g) === 'MELI');
  const today = dayOf(now);
  const ruleStart = dayOf(Date.parse(`${REPORT_RULE.startDay}T12:00:00Z`) / 1000);

  // Todos los dias desde que inicio la regla que aun tienen mensajes guardados
  const computed = new Map(); // dia -> Map(id del grupo -> { start, slots })
  for (const g of ruleGroups) {
    const list = normalized.get(g.id) ?? [];
    for (let day = ruleStart; day <= today; day++) {
      const r = slotsForDay(list, day, isMonitor, now);
      if (!r) continue;
      const key = dayKey(day);
      if (!computed.has(key)) computed.set(key, new Map());
      computed.get(key).set(g.id, r);
    }
  }

  // Guarda en el historico los dias ya terminados
  let changed = false;
  for (const [key, perGroup] of computed) {
    if (key >= dayKey(today)) continue;
    const entry = {
      ...tally([...perGroup.values()].flatMap((r) => r.slots)),
      groups: Object.fromEntries(
        ruleGroups
          .filter((g) => perGroup.has(g.id))
          .map((g) => {
            const r = perGroup.get(g.id);
            return [g.id, { name: g.name, start: r.start, ...tally(r.slots), slots: withNames(r.slots, nameOf) }];
          }),
      ),
    };
    if (JSON.stringify(history.days[key]) !== JSON.stringify(entry)) {
      history.days[key] = entry;
      changed = true;
    }
  }
  if (changed) saveHistory();

  // Cifras del periodo elegido (reportes que vencen desde `since`)
  const all = [];
  const byGroup = ruleGroups.map((g) => {
    const days = [];
    for (const [key, perGroup] of computed) {
      const r = perGroup.get(g.id);
      if (!r) continue;
      const slots = r.slots.filter((s) => s.due >= since);
      days.push({ day: key, start: r.start, slots });
      for (const s of slots) all.push({ ...s, group: g, day: key });
    }
    const slots = days.flatMap((d) => d.slots);
    const todayEntry = computed.get(dayKey(today))?.get(g.id);
    // Detalle de cada dia: el historico y, encima, lo calculado con los mensajes guardados
    const dayDetail = {};
    for (const [key, h] of Object.entries(history.days)) if (h.groups[g.id]) dayDetail[key] = h.groups[g.id];
    for (const [key, perGroup] of computed) {
      const r = perGroup.get(g.id);
      if (r) dayDetail[key] = { start: r.start, ...tally(r.slots), slots: withNames(r.slots, nameOf) };
    }
    return {
      id: g.id,
      name: g.name,
      ...tally(slots),
      today: todayEntry ? { start: todayEntry.start, slots: withNames(todayEntry.slots, nameOf) } : null,
      days: dayDetail,
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
  // Cumplimiento por dia: todo el historico desde que inicio la regla, mas el dia de hoy
  const byDay = new Map(Object.entries(history.days).map(([key, h]) => [key, { day: key, ...h, groups: undefined }]));
  for (const [key, perGroup] of computed) byDay.set(key, { day: key, ...tally([...perGroup.values()].flatMap((r) => r.slots)) });
  return {
    rule: { ...REPORT_RULE },
    started: today >= ruleStart,
    groups: ruleGroups.length,
    totals: tally(all),
    byGroup: byGroup.sort((a, b) => (a.compliance ?? 2) - (b.compliance ?? 2)),
    byMember: [...people.values()].map((p) => ({ ...p, groups: [...p.groups] })).sort((a, b) => b.reports - a.reports),
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
}
