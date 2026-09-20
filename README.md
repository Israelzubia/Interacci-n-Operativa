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

## Aviso

La conexión por QR usa un cliente no oficial de WhatsApp Web (Baileys). Existe riesgo de que WhatsApp restrinja el número usado.
