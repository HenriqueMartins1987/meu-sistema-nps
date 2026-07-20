#!/usr/bin/env bash
set -Eeuo pipefail

export TZ="America/Sao_Paulo"

APP_DIR="/root/meu-sistema-nps/backend"
cd "$APP_DIR"

echo
echo "============================================================"
echo "MONITOR_NPS_PRODUCAO=$(date '+%Y-%m-%d %H:%M:%S')"
echo "APP_DIR=$APP_DIR"
echo "============================================================"

echo
echo "=== 1. PM2 STATUS ==="
pm2 status || true

echo
echo "=== 2. CRONS NPS INSTALADOS ==="
crontab -l | grep -E 'runEcuroNpsScheduledCollection|runNpsPostResponseAutomation|syncNpsQueueResponsesToDatabase|syncNpsReferralsToDentalCard' || true

echo
echo "=== 3. VARIAVEIS DE PRODUCAO NPS ==="
node - <<'NODE'
require('dotenv').config({ quiet: true });

const keys = [
  'NPS_SCOPE',
  'ECURO_ROBOT_DRY_RUN',
  'NPS_DISPATCH_ENABLED',
  'NPS_DISPATCH_INTERVAL_SECONDS',
  'NPS_DISPATCH_MAX_PER_RUN',
  'NPS_MAX_DAILY_PER_SESSION',
  'NPS_DISPATCH_WINDOW_START',
  'NPS_DISPATCH_WINDOW_END',
  'ECURO_NPS_DATE_MODE',
  'ECURO_MAX_CLINICS_PER_RUN',
  'NPS_SESSION_ID',
  'NPS_WHATSAPP_SESSION_ID',
  'ECURO_ROBOT_SERVICE_URL'
];

const out = {};

for (const key of keys) {
  out[key] = process.env[key] || 'AUSENTE';
}

console.table(out);
NODE

echo
echo "=== 4. HEALTH ROBO ECURO LOCAL ==="
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
echo "=== 5. HEALTH ROBO ECURO PUBLICO ==="

curl \
  -sS \
  --max-time 60 \
  -w "\nHTTP_CODE=%{http_code}\n" \
  -H "x-api-key: ${ROBOT_API_KEY}" \
  "http://2.24.101.6:3010/health" \
|| true

unset ROBOT_API_KEY

echo
echo "=== 6. STATUS WHATSAPP SESSAO NPS ==="
node - <<'NODE'
require('dotenv').config({ quiet: true });

(async () => {
  const baseUrl =
    process.env.WHATSAPP_API_URL ||
    process.env.WHATSAPP_SERVICE_BASE_URL ||
    'http://127.0.0.1:3005';

  const apiKey =
    process.env.WHATSAPP_API_KEY;

  const sessionId =
    process.env.NPS_SESSION_ID ||
    'nps';

  const response =
    await fetch(
      `${baseUrl}/sessions/${sessionId}/status`,
      {
        headers: {
          'x-api-key': apiKey
        }
      }
    );

  console.log({
    status: response.status,
    body: await response.text()
  });
})().catch(error => {
  console.error({
    status: 'WHATSAPP_SESSION_CHECK_FAILED',
    message: error.message
  });
});
NODE

echo
echo "=== 7. FILA NPS LOCAL ==="
node - <<'NODE'
const fs = require('fs');

const queueFile =
  'runtime/ecuro-db/ecuro-nps-queue.json';

if (!fs.existsSync(queueFile)) {
  console.log({
    status: 'QUEUE_FILE_NOT_FOUND'
  });

  process.exit(0);
}

const stat =
  fs.statSync(queueFile);

const queue =
  JSON.parse(
    fs.readFileSync(queueFile, 'utf8')
  );

const metrics = {
  modifiedAt:
    stat.mtime.toISOString(),

  total:
    queue.length,

  pending:
    queue.filter(item => item.status === 'pending').length,

  sent:
    queue.filter(item => item.status === 'sent').length,

  responded:
    queue.filter(item => item.npsScore !== undefined && item.npsScore !== null).length,

  promoters:
    queue.filter(item => Number(item.npsScore) >= 9).length,

  neutrals:
    queue.filter(item => Number(item.npsScore) >= 7 && Number(item.npsScore) <= 8).length,

  detractors:
    queue.filter(item => Number(item.npsScore) >= 0 && Number(item.npsScore) <= 6).length,

  referrals:
    queue.filter(item => item.referralContact).length,

  sendFailed:
    queue.filter(item => ['send_failed', 'send_error'].includes(String(item.status || ''))).length,

  duplicateBlocked:
    queue.filter(item => String(item.status || '') === 'duplicate_same_day_blocked').length,

  syncErrors:
    queue.filter(item => item.npsDatabaseSyncError).length
};

console.table([metrics]);

console.log('\n=== ULTIMOS 20 ITENS DA FILA ===');

console.table(
  queue.slice(-20).map(item => ({
    id: String(item.id || '').slice(0, 32),
    patientName: item.patientName,
    phone: item.patientPhone,
    clinicCode: item.clinicCode,
    clinicName: String(item.clinicName || '').slice(0, 60),
    status: item.status,
    score: item.npsScore,
    class: item.npsClass || item.npsProfile,
    stage: item.npsConversationStage,
    source: String(item.source || '').slice(0, 40),
    syncError: item.npsDatabaseSyncError || null
  }))
);
NODE

echo
echo "=== 8. BANCO NPS / RESPOSTAS / VCARD / DENTAL CARD ==="
node scripts/validateNpsDatabaseAutomationState.js || true

echo
echo "=== 9. ULTIMO LOG COLETA ECURO ==="
COLLECTION_LOG="runtime/ecuro-scheduler-logs/ecuro-nps-collection-$(date '+%Y%m%d').log"

if [ -f "$COLLECTION_LOG" ]; then
  tail -n 120 "$COLLECTION_LOG"
else
  echo "LOG_COLETA_AINDA_NAO_EXISTE=$COLLECTION_LOG"
fi

echo
echo "=== 10. ULTIMO LOG POS-PROCESSAMENTO ==="
POST_LOG="runtime/ecuro-scheduler-logs/nps-post-response-automation-$(date '+%Y%m%d').log"

if [ -f "$POST_LOG" ]; then
  tail -n 120 "$POST_LOG"
else
  echo "LOG_POS_PROCESSAMENTO_AINDA_NAO_EXISTE=$POST_LOG"
fi

echo
echo "=== 11. LOGS WHATSAPP COM ERROS IMPORTANTES ==="
pm2 logs whatsapp-service --lines 500 --nostream \
| grep -E 'Mensagem recebida|NPS webhook sincronizado|falha ao sincronizar|sem pesquisa aberta|Erro ao processar|HTTP 401|HTTP 500|send_failed|send_error' \
|| true

echo
echo "============================================================"
echo "FIM_MONITOR_NPS_PRODUCAO=$(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
