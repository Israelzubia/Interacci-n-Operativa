#!/bin/bash
# Acceso directo: enciende la plataforma si esta apagada y la abre en el navegador.
DIR="/Users/israelzubia/Interacci-n-Operativa"
URL="http://localhost:3000"
LOG="$HOME/Library/Logs/interaccion-operativa.log"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

if curl -s --max-time 2 "$URL/api/status" >/dev/null; then
  echo "La plataforma ya está encendida."
else
  echo "Encendiendo la plataforma…"
  mkdir -p "$(dirname "$LOG")"
  cd "$DIR" && nohup node src/server.js >>"$LOG" 2>&1 &
  disown
  for _ in $(seq 1 30); do
    curl -s --max-time 1 "$URL/api/status" >/dev/null && break
    sleep 1
  done
fi

open "$URL"
echo "Listo. Puedes cerrar esta ventana; la plataforma sigue encendida."
exit 0
