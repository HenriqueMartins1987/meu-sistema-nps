#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/root/meu-sistema-nps/backend"
cd "$APP_DIR"

echo "=== PM2 ==="
pm2 status

echo
echo "=== CRON ==="
crontab -l | grep 'runEcuroNpsScheduledCollection' || true

echo
echo "=== HEALTH ROBO LOCAL ==="
ROBOT_API_KEY="$(
  node - <<'NODE'
require('dotenv').config({ quiet: true });
process.stdout.write(String(process.env.ECURO_ROBOT_API_KEY || '').trim());
NODE
)"

curl \
  -sS \
  --max-time 60 \
  -w "\nHTTP_CODE=%{http_code}\n" \
  -H "x-api-key: ${ROBOT_API_KEY}" \
  "http://127.0.0.1:3010/health" \
|| true

echo
echo "=== HEALTH ROBO PUBLICO ==="

curl \
  -sS \
  --max-time 60 \
  -w "\nHTTP_CODE=%{http_code}\n" \
  -H "x-api-key: ${ROBOT_API_KEY}" \
  "http://2.24.101.6:3010/health" \
|| true

unset ROBOT_API_KEY

echo
echo "=== FRESHNESS FILA ==="
node scripts/validateNpsQueueFreshness.js || true

echo
echo "=== LOG COLETA HOJE ==="
LOG_FILE="runtime/ecuro-scheduler-logs/ecuro-nps-collection-$(date '+%Y%m%d').log"

if [ -f "$LOG_FILE" ]; then
  tail -n 120 "$LOG_FILE"
else
  echo "LOG_NAO_EXISTE=$LOG_FILE"
fi

echo
echo "=== CLINICAS COM ELEGIVEIS ==="
node - <<'NODE'
const fs = require('fs');

const {
  enrichClinicFields
} = require('./services/npsClinicRegistry');

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

const queueFile = 'runtime/ecuro-db/ecuro-nps-queue.json';

if (!fs.existsSync(queueFile)) {
  console.log({ status: 'QUEUE_NOT_FOUND' });
  process.exit(0);
}

const queue = JSON.parse(
  fs.readFileSync(queueFile, 'utf8')
);

const map = new Map();

for (const rawItem of queue) {
  const item = enrichClinicFields(rawItem);

  if (!item.clinicRegistryResolved) continue;

  const phone = normalizePhone(item.patientPhone);

  if (phone.length < 12 || phone.length > 13) continue;
  if (String(item.source || '').includes('homologacao')) continue;
  if (String(item.npsConversationStage || '') === 'finished') continue;
  if ([
    'responded',
    'failed',
    'archived_test',
    'duplicate_same_day_blocked'
  ].includes(String(item.status || ''))) continue;

  const key = `${item.clinicCode} | ${item.clinicName}`;

  if (!map.has(key)) {
    map.set(key, {
      clinicCode: item.clinicCode,
      clinicName: item.clinicName,
      eligible: 0
    });
  }

  map.get(key).eligible += 1;
}

const rows = Array
  .from(map.values())
  .sort((a, b) => b.eligible - a.eligible);

console.table(rows);
console.log({ totalClinicsWithEligible: rows.length });
NODE
