# Contexto del proyecto · Interacción Operativa

> Resumen de la sesión de trabajo con Claude Code (24–27 sep 2026) para continuar en una sesión nueva.
> Repositorio: https://github.com/Israelzubia/Interacci-n-Operativa · rama `main` · último commit (ver `git log`).

---

## 1. Qué es el proyecto

Plataforma local para **monitorear la operación de última milla de BDB** a través de los grupos de WhatsApp de la cuenta de Israel Zubia. Se conecta a WhatsApp con QR (cliente no oficial **Baileys 7.0.0-rc14**) y ofrece una interfaz web en `http://localhost:3000`.

**Objetivo actual del usuario:** medir **la interacción de su equipo de trabajo con clientes y proveedores**: tiempos de respuesta, mensajes sin contestar, quién atiende a quién y carga por persona.

- Stack: Node.js (ES modules), Express 5, Baileys, pino, qrcode. Sin framework en el frontend: HTML y JS plano.
- Arranque: `npm start` (`node src/server.js`). El servidor solo escucha en `127.0.0.1`.
- `.claude/launch.json` tiene la configuración `app` (npm start, puerto 3000) para abrir la vista previa en Claude Code. **No está en git.**
- Datos locales (en `.gitignore`):
  - `auth/`: sesión de WhatsApp. Es una credencial. Incluye unas 1,800 relaciones `lid-mapping` entre ID interno y número.
  - `data/messages.json`: mensajes guardados (unos 6.5 MB).
  - `data/people.json`: roles confirmados y nombres de personas.

---

## 2. Arquitectura (archivos en `src/`)

| Archivo | Función |
|---|---|
| `whatsapp.js` | Conexión Baileys (`syncFullHistory: true`), QR, reconexión. Escucha `messages.upsert` y `messaging-history.set` (→ `store.addMessage`) y `contacts.upsert`/`contacts.update` (→ `people.rememberName`). |
| `store.js` | Guarda los mensajes de **grupos** en `data/messages.json`. **Retención de 30 días, tope de 5,000 por grupo**; la interfaz recibe solo los últimos 500. Cada mensaje guarda: `id, from (nombre visible), fromMe, sender (número o @lid; 'me' si es la cuenta), quotedId (mensaje citado), text, ts`. `getStats()` da `messageCount, lastMessageAt, messages24h, messages7d`. |
| `clients.js` | Reglas sobre el **nombre del grupo** → `clientOf(name)` y `typeOf(name)`. |
| `groups.js` | `fetchGroups()` (metadatos con integrantes, cliente y tipo) y `listGroups()` (para la interfaz, con estadísticas). |
| `people.js` | Directorio de personas: `listPeople(sock, groups, chats)`, `setRole`, `rememberName`, `pickJid`. Traduce `@lid` → número con `sock.signalRepository.lidMapping.getPNForLID`. |
| `server.js` | API (abajo). |
| `public/index.html`, `public/app.js` | Vista **Grupos**: panel de análisis y lista de grupos. |
| `public/people.js` | Vista **Personas**: revisión de roles. |

### API
- `GET /api/status` → estado de la conexión.
- `POST /api/connect`, `POST /api/logout`
- `GET /api/groups` → grupos con `client, type, participants, messageCount, lastMessageAt, messages24h, messages7d`.
- `GET /api/groups/:id/messages` → últimos 500 mensajes.
- `GET /api/people` → personas con `jid, name, phone, isMe, groupCount, groups, types, clients, messages, lastMessageAt, suggested, role, confirmed`.
- `POST /api/people/role` → `{ jid | jids: [], role: 'Equipo'|'Cliente'|'Proveedor'|null }`. Con `null` se quita la confirmación.

---

## 3. Clasificación de grupos (acordada con el usuario)

**Cliente** (primera regla que coincide, en este orden):
1. **Coppel**: "coppel"
2. **Onest**: "onest"
3. **WM**: "WM", "walmart", "pananpack"
4. **Estafeta**: "estafeta", o los códigos MXH, MXP y MXT
5. **MELI**: "meli", "mercado libre", "MLP", o los códigos de sitio SMT, SCQ, SQR, STR, SZL, SGD y STL seguidos de un dígito. Caso puntual: *SDG1 - BDB*.
6. **Amazon**: "amazon", DMT + dígito, "DSP"/"DSPs"
7. **Big Ticket**: "big ticket"
8. **Otros**: todo lo demás.

**Tipo:**
- **Proveedores**: "proveedor", "extern", *SMT2 DR // MGP LOGISTIC*, *Rentals*
- **Clientes**: nombre con `<>`, "estafeta", o *SQR2 - BDB…*, *SGD1 - BDB…*, *SDG1 - BDB*, *BDB- MeLi…*, *BDB LOGISTICA-MELI*, *Walmart - Pananpack*, *BDB & Onest…*
- **Interno**: todo lo demás.

**Decisiones del usuario:**
- *SDG1 - BDB* es MELI. *SDG1 / INTERNOS* y *BDB SDG1 REPORTES SANTIAGO* son grupos internos, no de MELI.
- *LP BDB LOGISTICA*, *BDB DISPATCHERS*, *Seguimiento Inv SMA* y *MXXQR1 (LH)* **no son MELI**.
- *Colima - BDB* es un grupo interno. Onest también opera en Colima.
- Proquimed, Rutaflow y Unilabs **no** son grupos con cliente. Los de Estafeta **sí**.
- Amazon y Big Ticket se agregaron como clientes.
- **Pendiente:** *MXXQR1 (LH) <> BDB logistica* es un grupo con cliente, pero no se sabe de qué cliente; está en "Otros".

**Conteos al 26 sep:** 152 grupos. Clientes 31 · Proveedores 9 · Interno 112. MELI 57 · WM 11 · Onest 3 · Estafeta 6 · Coppel 10 · Amazon 8 · Big Ticket 1 · Otros 56.

---

## 4. Interfaz

**Vista Grupos**
- Indicadores: grupos, activos en 24 h, mensajes en 24 h (y en 7 días), sin actividad en 7 días.
- Matriz cliente × tipo con número de grupos y mensajes de 24 h. El tono de azul indica actividad. Al dar clic se filtra la lista.
- Barras de mensajes en 24 h por cliente, con clic para filtrar.
- Top 10 de grupos más activos; al dar clic se filtra la lista y se abre el grupo.
- Lista de grupos con pestañas **Tipo** y **Cliente** combinables, búsqueda y secciones "Con mensajes" y "Sin mensajes". Cada grupo muestra etiquetas de cliente y tipo y se despliega para ver sus mensajes.

**Vista Personas**
- Indicadores por rol: Equipo, Cliente, Proveedor y Por confirmar.
- Pestañas por rol, búsqueda por nombre o número, filtro por grupo y "Solo por confirmar".
- Tabla ordenada por mensajes enviados. Cada fila tiene un selector de rol y un botón "Confirmar" para aceptar la sugerencia.
- **Asignación en bloque**: al filtrar por grupo o búsqueda, asigna el mismo rol a todas las personas mostradas; respeta la pestaña de rol activa.
- **Sugerencia de rol**: Equipo si participa en algún grupo Interno o si es la cuenta propia; Proveedor si solo está en grupos de proveedores; Cliente si solo está en grupos con clientes; si no, sin clasificar.

**Estilo:** colores definidos en `:root` con modo oscuro; secuencial azul `--seq`. Se probó en computadora y en celular.

---

## 5. Plan para medir la interacción del equipo (acordado)

1. ✅ Definir métricas: tiempo de respuesta, mensajes sin contestar, quién atiende a quién, carga por persona, horarios.
2. ✅ **Guardar la identidad del remitente** (`sender`) y el mensaje citado (`quotedId`). Solo aplica a mensajes nuevos, desde el 27 sep; al 27 sep ya había unos 1,925 mensajes con remitente y 229 respuestas citadas.
3. ✅ **Directorio de personas**: 25 personas confirmadas como Equipo (3 oct). El Equipo = confirmados + la cuenta propia; todos los demás cuentan como contraparte (Cliente o Proveedor según el tipo de grupo). Horario: todos los días de 4:00 a 23:59 (UTC-6); la noche (0:00–4:00) no cuenta en la espera; tiempo máximo sin respuesta: 10 min (opciones 5 y 10); se ignoran acuses como "ok", "enterado", emojis o stickers.
4. ✅ **Detectar respuestas** (`src/interaction.js`, 3 oct): una cita (`quotedId`) es respuesta explícita; si no hay cita, se toma el primer mensaje del Equipo después de uno de un Cliente o Proveedor en el mismo grupo.
5. ✅ **Métricas en el panel** (vista **Interacción**, `GET /api/interaction?days=&threshold=`): tiempo de respuesta (mediana y promedio) por cliente, proveedor y persona; mensajes sin contestar después de X minutos; participación del equipo por cliente; actividad por hora.
6. ⏳ Alertas opcionales, por ejemplo un mensaje de cliente sin respuesta después de 30 minutos.

**Aviso de privacidad:** se recomendó informar al equipo que se miden los tiempos de respuesta y revisar el aviso de privacidad con el área legal (LFPDPPP, México), porque se guardan datos de personas de clientes y proveedores.

---

## 6. Problemas conocidos y cosas a tener en cuenta

- **Las sugerencias de rol son demasiado amplias:** 745 personas salen como "Equipo" porque basta con estar en un grupo interno. Por ejemplo, *PENTÁGONO MERCADO LIBRE* y *Transporte Furiosa* salen como Equipo. Los grupos de proveedores también tienen personal de BDB, como *STL1-PROVEEDORES*, con 18 personas del equipo y 2 proveedores. Hay que tener cuidado con la asignación en bloque.
- **Nombres:** casi todas las personas aparecen como "Sin nombre" hasta que escriben. Para tener los nombres como están en la agenda del teléfono habría que desvincular y volver a vincular el QR, porque WhatsApp manda los contactos en la sincronización inicial.
- **Conteos de 7 días:** antes solo se guardaban 500 mensajes por grupo, así que los datos anteriores al 26 sep están incompletos en los grupos muy activos. Se normalizan con el tiempo.
- `syncFullHistory` solo trae el historial completo al vincular por primera vez.
- Al abrir la página, la lista de grupos reintenta sola si `/api/groups` todavía falla justo después de conectar. Esto ya está corregido.
- Tras cambiar código del servidor hay que reiniciarlo, porque no hay recarga automática.

---

## 7. Git y GitHub

Commits principales:
```
b4777ed feat: directorio de personas con roles y captura de remitentes
0f4016b feat: panel de analisis de grupos y retencion de 30 dias
1ee38d7 feat: clasifica grupos por cliente y por tipo
0457efd feat: guarda y muestra mensajes de grupos
f9dfd87 docs: agrega README con uso y aviso de riesgo
```
- Autenticación: Personal Access Token *fine-grained* con **Contents: Read and write** sobre este repositorio, guardado en el llavero de macOS (`credential.helper osxkeychain`). `git push` ya funciona sin pedir credenciales.
- `gh` (GitHub CLI) está instalado, pero **no tiene sesión iniciada** (el usuario prefirió el token).
- ⚠️ **Pendiente de seguridad:** revocar el token que quedó expuesto en una captura y en el historial de zsh, y borrarlo con `sed -i '' '/github_pat_/d' ~/.zsh_history`.
- `.claude/` sigue fuera de git. Falta decidir si se agrega a `.gitignore`.
- Las firmas de commit usadas: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## 8. Siguientes pasos sugeridos

1. El usuario revisa y confirma roles en **Personas**, empezando por las primeras 100-150 personas por número de mensajes.
2. Implementar los pasos 4 y 5: detección de respuestas y métricas de interacción (tiempos de respuesta y pendientes por cliente, proveedor y persona) en una vista o sección nueva.
3. Definir con el usuario el umbral de "sin respuesta" (por ejemplo, 30 minutos) y el horario laboral.
4. Opcional: mejorar la sugerencia de roles, por ejemplo con el nombre de la persona ("BDB" → Equipo) o su proporción de grupos por tipo.
5. Opcional: asignar cliente a *MXXQR1 (LH)*.
6. Opcional: actualizar el README con las funciones nuevas.

## 9. Preferencias del usuario

- Trabaja en **español**.
- Pide confirmación antes de commits y push; aprueba paso a paso.
- Prefiere que el trabajo se pruebe en el navegador antes de entregarlo.
