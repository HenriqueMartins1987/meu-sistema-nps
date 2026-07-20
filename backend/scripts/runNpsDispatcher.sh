#!/usr/bin/env bash
set -Eeuo pipefail

export TZ="America/Sao_Paulo"

APP_DIR="/root/meu-sistema-nps/backend"
LOCK_FILE="/tmp/nps-dispatcher.lock"

cd "$APP_DIR"

exec 9>"$LOCK_FILE"

if ! flock -n 9; then
  echo "NPS_DISPATCHER_JA_EM_EXECUCAO=SIM"
  exit 0
fi

NPS_DISPATCH_ENABLED=true \
node scripts/dispatchPendingNpsQueue.js
