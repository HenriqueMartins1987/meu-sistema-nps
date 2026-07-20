#!/usr/bin/env bash
set -Eeuo pipefail

export TZ="America/Sao_Paulo"

cd /root/meu-sistema-nps/backend

node - <<'NODE'
require('dotenv').config({ quiet: true });

(async () => {
  const baseUrl =
    process.env.WHATSAPP_API_URL
    || process.env.WHATSAPP_SERVICE_BASE_URL
    || 'http://127.0.0.1:3005';

  const apiKey =
    process.env.WHATSAPP_API_KEY;

  const statusResponse = await fetch(
    `${baseUrl}/sessions/nps/status`,
    {
      headers: {
        'x-api-key': apiKey
      }
    }
  );

  const statusBody =
    await statusResponse.json()
      .catch(() => ({}));

  const status =
    String(statusBody.status || '');

  console.log({
    checkedAt: new Date().toISOString(),
    sessionId: 'nps',
    status
  });

  if (
    [
      'conectado',
      'autenticado',
      'iniciando',
      'aguardando_qrcode'
    ].includes(status)
  ) {
    process.exit(0);
  }

  const startResponse = await fetch(
    `${baseUrl}/sessions/start`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify({
        sessionId: 'nps'
      })
    }
  );

  console.log({
    action: 'SESSION_START_REQUESTED',
    httpStatus: startResponse.status,
    body: await startResponse.text()
  });
})().catch(error => {
  console.error({
    status: 'WHATSAPP_SESSION_CHECK_FAILED',
    error: error.message
  });

  process.exit(1);
});
NODE
