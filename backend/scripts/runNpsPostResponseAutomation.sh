#!/usr/bin/env bash
set -Eeuo pipefail

export TZ="America/Sao_Paulo"

APP_DIR="/root/meu-sistema-nps/backend"
LOG_DIR="$APP_DIR/runtime/ecuro-scheduler-logs"
LOCK_FILE="/tmp/nps-post-response-automation.lock"

mkdir -p "$LOG_DIR"

LOG_FILE="$LOG_DIR/nps-post-response-automation-$(date '+%Y%m%d').log"

exec >> "$LOG_FILE" 2>&1

echo
echo "============================================================"
echo "INICIO_NPS_POST_RESPONSE_AUTOMATION=$(date '+%Y-%m-%d %H:%M:%S')"
echo "APP_DIR=$APP_DIR"
echo "============================================================"

cd "$APP_DIR"

exec 9>"$LOCK_FILE"

if ! flock -n 9; then
  echo "ROTINA_JA_EM_EXECUCAO=SIM"
  echo "FIM_NPS_POST_RESPONSE_AUTOMATION=$(date '+%Y-%m-%d %H:%M:%S')"
  echo "============================================================"
  exit 0
fi

echo
echo "=== 1_SYNC_RESPOSTAS_FILA_PARA_BANCO ==="
node scripts/syncNpsQueueResponsesToDatabase.js

echo
echo "=== 2_LIMPEZA_VCARD_COMENTARIOS ==="
node scripts/cleanNpsVcardComments.js

echo
echo "=== 3_ENVIO_INDICACOES_PARA_DENTAL_CARD ==="
node scripts/syncNpsReferralsToDentalCard.js

echo
echo "=== 4_VALIDACAO_BANCO_NPS ==="
node scripts/validateNpsDatabaseAutomationState.js

echo
echo "FIM_NPS_POST_RESPONSE_AUTOMATION=$(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
