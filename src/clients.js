// Reglas para asignar cada grupo a un cliente segun su nombre.
// Se evaluan en orden: la primera que coincide gana.
const RULES = [
  { client: 'Coppel', test: /coppel/i },
  { client: 'Onest', test: /onest/i },
  { client: 'WM', test: /\bWM\b|walmart|pananpack/i },
  // Estafeta: por nombre o por codigo de plaza (MXH, MXP, MXT)
  { client: 'Estafeta', test: /estafeta|\bMX[HPT]\b/i },
  // MELI: por nombre o por codigo de sitio (SMT1, SCQ1, SQR2, STR1, SZL1, SGD1, STL1, MLP…)
  { client: 'MELI', test: /meli|mercado\s*libre|\bMLP\b|\b(SMT|SCQ|SQR|STR|SZL|SGD|STL)\d/i },
  // Casos puntuales que no siguen el patron
  { client: 'MELI', test: /^SDG1 - BDB$/i },
  // Amazon: por nombre, estaciones DMT o DSPs
  { client: 'Amazon', test: /amazon|\bDMT\d|\bDSPs?\b/i },
  { client: 'Big Ticket', test: /big\s*ticket/i },
];

export function clientOf(name) {
  return RULES.find((r) => r.test.test(name))?.client ?? 'Otros';
}

// Tipo de grupo segun con quien es: proveedores externos, el cliente o solo equipo interno.
const TYPE_RULES = [
  { type: 'Proveedores', test: /proveedor|extern|mgp logistic|^rentals\s*$/i },
  { type: 'Clientes', test: /<>|estafeta/i },
  // Grupos con el cliente que no usan "<>" en el nombre
  {
    type: 'Clientes',
    test: /^(SQR2 - BDB|SGD1 - BDB|SDG1 - BDB|BDB- MeLi|BDB LOGISTICA-MELI|Walmart - Pananpack|BDB & Onest)/i,
  },
];

export function typeOf(name) {
  return TYPE_RULES.find((r) => r.test.test(name))?.type ?? 'Interno';
}
