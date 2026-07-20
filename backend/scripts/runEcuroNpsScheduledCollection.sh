#!/usr/bin/env bash
set -Eeuo pipefail

export TZ="America/Sao_Paulo"

APP_DIR="/root/meu-sistema-nps/backend"
LOG_DIR="$APP_DIR/runtime/ecuro-scheduler-logs"
LOCK_FILE="/tmp/ecuro-nps-scheduled-collection.lock"

mkdir -p "$LOG_DIR"

LOG_FILE="$LOG_DIR/ecuro-nps-collection-$(date '+%Y%m%d').log"

exec >> "$LOG_FILE" 2>&1

echo
echo "============================================================"
echo "WRAPPER_INICIO=$(date '+%Y-%m-%d %H:%M:%S')"
echo "APP_DIR=$APP_DIR"
echo "FORCE_RUN=${FORCE_RUN:-false}"
echo "ECURO_NPS_DATE_MODE=${ECURO_NPS_DATE_MODE:-today}"
echo "============================================================"

cd "$APP_DIR"

LOCK_FILE="/tmp/ecuro-nps-collection.lock"

exec 9>"$LOCK_FILE"

if ! flock -n 9; then
  echo "COLETA_ECURO_JA_EM_EXECUCAO=SIM"
  echo "IGNORANDO_NOVA_EXECUCAO_PARA_EVITAR_FECHAR_BROWSER=SIM"
  exit 0
fi



exec 9>"$LOCK_FILE"

if ! flock -n 9; then
  echo "COLETA_JA_EM_EXECUCAO=SIM"
  exit 0
fi

node scripts/runEcuroNpsScheduledCollection.js

echo "WRAPPER_FIM=$(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
