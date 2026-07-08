#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${ROOT_DIR:-/root/meu-sistema-nps}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_BRANCH="${BACKUP_BRANCH:-backup/vps-stable-${TIMESTAMP}}"
SOURCE_ARCHIVE="${BACKUP_DIR}/meu-sistema-nps-source-${TIMESTAMP}.tar.gz"
RUNTIME_ARCHIVE="${BACKUP_DIR}/ecuro-runtime-private-${TIMESTAMP}.tar.gz"

if [[ ! -d "${ROOT_DIR}/.git" ]]; then
  echo "ERRO: repositório Git não encontrado em ${ROOT_DIR}" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

cd "${ROOT_DIR}"

echo "============================================================"
echo "1. BACKUP DO CÓDIGO-FONTE SEM SEGREDOS"
echo "============================================================"

tar \
  --exclude='.git' \
  --exclude='backend/.env' \
  --exclude='frontend/.env' \
  --exclude='.env' \
  --exclude='**/.env' \
  --exclude='backend/node_modules' \
  --exclude='frontend/node_modules' \
  --exclude='node_modules' \
  --exclude='backend/runtime/ecuro-db' \
  --exclude='**/*.log' \
  --exclude='**/*.bak-*' \
  --exclude='**/*.backup*' \
  -czf "${SOURCE_ARCHIVE}" \
  -C "$(dirname "${ROOT_DIR}")" \
  "$(basename "${ROOT_DIR}")"

chmod 600 "${SOURCE_ARCHIVE}"
ls -lh "${SOURCE_ARCHIVE}"

echo
echo "============================================================"
echo "2. BACKUP PRIVADO DOS DADOS RUNTIME"
echo "============================================================"

if [[ -d "${ROOT_DIR}/backend/runtime/ecuro-db" ]]; then
  tar -czf "${RUNTIME_ARCHIVE}" \
    -C "${ROOT_DIR}/backend/runtime" \
    ecuro-db
  chmod 600 "${RUNTIME_ARCHIVE}"
  ls -lh "${RUNTIME_ARCHIVE}"
else
  echo "Diretório backend/runtime/ecuro-db não encontrado; backup runtime ignorado."
fi

echo
echo "============================================================"
echo "3. ESTADO GIT ATUAL"
echo "============================================================"

git branch --show-current
git status --short

echo
echo "============================================================"
echo "4. BRANCH DE BACKUP DA VPS"
echo "============================================================"

if git show-ref --verify --quiet "refs/heads/${BACKUP_BRANCH}"; then
  git switch "${BACKUP_BRANCH}"
else
  git switch -c "${BACKUP_BRANCH}"
fi

# Nunca incluir segredos, dependências, runtime privado, logs ou backups no commit.
git add -A -- . \
  ':(exclude)backend/.env' \
  ':(exclude)frontend/.env' \
  ':(exclude).env' \
  ':(exclude)**/.env' \
  ':(exclude)backend/node_modules/**' \
  ':(exclude)frontend/node_modules/**' \
  ':(exclude)node_modules/**' \
  ':(exclude)backend/runtime/ecuro-db/**' \
  ':(exclude)**/*.log' \
  ':(exclude)**/*.bak-*' \
  ':(exclude)**/*.backup*'

echo "Arquivos preparados para commit:"
git diff --cached --name-only

if git diff --cached --quiet; then
  echo "Nenhuma alteração de código para commit. A branch ainda será publicada como snapshot do HEAD atual."
else
  git commit -m "backup: snapshot estável da VPS antes do NPS Enterprise"
fi

echo
echo "============================================================"
echo "5. PUBLICAÇÃO SEGURA DA BRANCH DE BACKUP"
echo "============================================================"

git push -u origin "${BACKUP_BRANCH}"

echo
echo "============================================================"
echo "BACKUP CONCLUÍDO"
echo "============================================================"
echo "Branch GitHub: ${BACKUP_BRANCH}"
echo "Arquivo-fonte: ${SOURCE_ARCHIVE}"
echo "Backup runtime privado: ${RUNTIME_ARCHIVE}"
echo
echo "ATENÇÃO: o backup runtime contém dados sensíveis e não foi enviado ao GitHub."
