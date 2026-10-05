# Interacción Operativa

Monitoreo de operación en grupos de WhatsApp y asistente de priorización de correo para última milla.

## Estado

Prototipo inicial: vincula tu WhatsApp con un código QR y lista los grupos conectados.

## Uso

```bash
npm install
npm start
```

Abre http://localhost:3000, escanea el QR (WhatsApp → Dispositivos vinculados) y verás tus grupos.

La sesión se guarda en `auth/` (ignorada por git). Trátala como una credencial: quien la tenga accede a tu cuenta.

## Siempre activo (servicio de macOS)

Para que la plataforma corra todo el tiempo, arranque sola al iniciar sesión en la Mac y se reinicie si se cae:

```bash
npm run service:install
```

- `npm run service:status` muestra si está corriendo y si WhatsApp está conectado.
- `npm run service:logs` muestra el registro (`~/Library/Logs/interaccion-operativa.log`).
- `npm run service:restart` lo reinicia (por ejemplo, después de actualizar el código).
- `npm run service:uninstall` lo quita.

Mientras corre como servicio, la Mac no entra en reposo si está conectada a la corriente. Si se cae la conexión
con WhatsApp, la plataforma reintenta sola. La sesión solo se pierde si se cierra desde el teléfono
(Dispositivos vinculados) o si el teléfono pasa unos 14 días sin conexión.

## Aviso

La conexión por QR usa un cliente no oficial de WhatsApp Web (Baileys). Existe riesgo de que WhatsApp restrinja el número usado.
