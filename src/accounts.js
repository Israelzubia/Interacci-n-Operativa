import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

// Cuenta a la que pertenece cada grupo: MELI, Multicuentas (el resto de los clientes) u Ops BDB (operacion interna).
// Se sugiere por el cliente del grupo y el usuario la confirma.
const FILE = 'data/groups.json';
export const ACCOUNTS = ['MELI', 'Multicuentas', 'Ops BDB'];

export const TYPES = ['Clientes', 'Proveedores', 'Interno'];

// accounts: id del grupo -> cuenta confirmada; types: id del grupo -> tipo confirmado
const saved = { accounts: {}, types: {} };
let timer = null;

try {
  Object.assign(saved, JSON.parse(readFileSync(FILE, 'utf8')));
} catch {
  // primera ejecucion: sin datos previos
}

// Escribe en un archivo temporal y lo renombra, para no dejar el archivo a medias si el proceso se detiene
function writeNow() {
  clearTimeout(timer);
  timer = null;
  mkdirSync('data', { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(saved));
  renameSync(`${FILE}.tmp`, FILE);
}

function persist() {
  clearTimeout(timer);
  timer = setTimeout(writeNow, 1000);
}

// Guarda de inmediato si hay cambios pendientes (al apagar el servidor)
export function flush() {
  if (timer) writeNow();
}

// Por nombre ("multicuentas", "MELI"); si no, MELI si el cliente es MELI, Multicuentas si es otro
// cliente conocido y Ops BDB si es un grupo interno sin cliente; el resto queda sin sugerencia
function suggestAccount(client, name = '', type = '') {
  if (/multi ?cuenta/i.test(name)) return 'Multicuentas';
  if (client === 'MELI' || /\bmeli\b/i.test(name)) return 'MELI';
  if (client && client !== 'Otros') return 'Multicuentas';
  if (type === 'Interno') return 'Ops BDB';
  return null;
}

export function accountOf(id, client, name, type) {
  const confirmed = saved.accounts[id] ?? null;
  const suggested = suggestAccount(client, name, type);
  return { account: confirmed ?? suggested, accountSuggested: suggested, accountConfirmed: !!confirmed };
}

// Confirma la cuenta de un grupo (o quita la confirmacion con account null)
export function setAccount(id, account) {
  if (!id) throw new Error('Falta el grupo');
  if (account && !ACCOUNTS.includes(account)) throw new Error(`Cuenta no válida: ${account}`);
  if (account) saved.accounts[id] = account;
  else delete saved.accounts[id];
  persist();
}

// Tipo del grupo (Clientes, Proveedores o Interno): el confirmado o el sugerido por el nombre
export function typeOfGroup(id, suggested) {
  const confirmed = saved.types?.[id] ?? null;
  return { type: confirmed ?? suggested, typeSuggested: suggested, typeConfirmed: !!confirmed };
}

// Confirma el tipo de un grupo (o quita la confirmacion con type null)
export function setType(id, type) {
  if (!id) throw new Error('Falta el grupo');
  if (type && !TYPES.includes(type)) throw new Error(`Tipo no válido: ${type}`);
  saved.types ??= {};
  if (type) saved.types[id] = type;
  else delete saved.types[id];
  persist();
}
