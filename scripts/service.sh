#!/bin/bash
# Servicio de macOS (launchd) para que la plataforma este siempre activa:
# arranca al iniciar sesion en la Mac, se reinicia sola si se cae y evita que la Mac se duerma.
#   bash scripts/service.sh install | uninstall | restart | status | logs
set -euo pipefail

LABEL=com.bdb.interaccion-operativa
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/interaccion-operativa.log"
DOMAIN="gui/$(id -u)"

case "${1:-}" in
  install)
    NODE="$(command -v node)"
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>src/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>KEEP_AWAKE</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "Servicio instalado. Plataforma en http://localhost:3000 · registro en $LOG"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Servicio desinstalado."
    ;;
  restart)
    launchctl kickstart -k "$DOMAIN/$LABEL"
    echo "Servicio reiniciado."
    ;;
  status)
    launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -E '^\s*(state|pid|last exit code|runs) =' || echo "El servicio no está instalado."
    curl -s --max-time 3 http://127.0.0.1:3000/api/status | cut -c1-120 || echo "La plataforma no responde."
    echo
    ;;
  logs)
    tail -n 50 -f "$LOG"
    ;;
  *)
    echo "Uso: bash scripts/service.sh install | uninstall | restart | status | logs"
    exit 1
    ;;
esac
