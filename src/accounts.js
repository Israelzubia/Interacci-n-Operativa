import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

// Cuenta a la que pertenece cada grupo: MELI o Multicuentas (el resto de los clientes).
// Se sugiere por el cliente del grupo y el usuario la confirma.
const FILE = 'data/groups.json';
export const ACCOUNTS = ['MELI', 'Multicuentas'];

// accounts: id del grupo -> cuenta confirmada
const saved = { accounts: {} };
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

// Por nombre ("multicuentas", "MELI"); si no, MELI si el cliente es MELI y Multicuentas si es otro
// cliente conocido; sin sugerencia en "Otros"
function suggestAccount(client, name = '') {
  if (/multi ?cuenta/i.test(name)) return 'Multicuentas';
  if (client === 'MELI' || /\bmeli\b/i.test(name)) return 'MELI';
  if (client && client !== 'Otros') return 'Multicuentas';
  return null;
}

export function accountOf(id, client, name) {
  const confirmed = saved.accounts[id] ?? null;
  const suggested = suggestAccount(client, name);
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
