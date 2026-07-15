#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/root/meu-sistema-nps/backend"
LOG_DIR="$APP_DIR/runtime/ecuro-scheduler-logs"
TODAY="$(date '+%Y%m%d')"
LOG_FILE="$LOG_DIR/ecuro-nps-collection-${TODAY}.log"

echo "=== PM2 STATUS ==="
pm2 status

echo
echo "=== CRON ==="
crontab -l | grep -E 'runEcuroNpsScheduledCollection|^$' || true

echo
echo "=== LOG DE HOJE ==="
if [ -f "$LOG_FILE" ]; then
  tail -n 120 "$LOG_FILE"
else
  echo "LOG_AINDA_NAO_EXISTE=$LOG_FILE"
fi

echo
echo "=== FILA NPS ==="
cd "$APP_DIR"

node - <<'NODE'
const fs = require('fs');

const file =
  'runtime/ecuro-db/ecuro-nps-queue.json';

if (!fs.existsSync(file)) {
  console.log({
    status: 'QUEUE_NOT_FOUND'
  });
  process.exit(0);
}

const stat = fs.statSync(file);

const queue = JSON.parse(
  fs.readFileSync(file, 'utf8')
);

console.log({
  modifiedAt: stat.mtime.toISOString(),
  totalQueue: queue.length
});
NODE
