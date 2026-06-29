# Robô Ecuro / NPS Automática

## Visão geral

O fluxo automático de NPS consulta o Ecuro por navegador, identifica pacientes concluídos e cria convites NPS enviados exclusivamente pela VPS de WhatsApp via `whatsappProvider.sendText()`.

Camadas:

- `backend/robot/ecuroRobotServer.js`: API interna protegida do robô.
- `backend/services/ecuroRobotService.js`: Playwright, login, coleta e matching.
- `backend/services/ecuroCompletionService.js`: integração com backend principal, NPS, idempotência e janela de envio.
- `backend/migrations/2026-06-29-ecuro-robot-nps.sql`: tabelas de jobs, status de conclusão e convites.

## Variáveis obrigatórias

- `EXTERNAL_PORTAL_MODE=browser`
- `EXTERNAL_PORTAL_LEVEL1_USERNAME`
- `EXTERNAL_PORTAL_LEVEL1_PASSWORD`
- `EXTERNAL_PORTAL_LEVEL2_USERNAME`
- `EXTERNAL_PORTAL_LEVEL2_PASSWORD`
- `EXTERNAL_PORTAL_BASE_URL=https://ecuro.com.br`
- `ROBOT_HEADLESS=true`
- `ROBOT_TIMEOUT_MS=60000`
- `ROBOT_MAX_ATTEMPTS=3`
- `ECURO_BROWSER_PROFILE_DIR=/var/lib/ecuro-robot/profile`
- `ECURO_ROBOT_SCREENSHOT_DIR=/var/log/ecuro-robot/screenshots`
- `ECURO_ROBOT_HTML_DIR=/var/log/ecuro-robot/html`
- `ECURO_ROBOT_API_KEY`
- `ECURO_ROBOT_HOST=127.0.0.1`
- `ECURO_ROBOT_PORT=3010`
- `ECURO_ROBOT_SERVICE_URL=http://127.0.0.1:3010`
- `ECURO_ROBOT_CRON=0 19 * * 1-6`
- `ECURO_ROBOT_DRY_RUN=true`
- `NPS_WHATSAPP_SESSION_ID=reclamacoes` (temporário; após homologação, voltar para `nps`)
- `NPS_PUBLIC_URL=https://meu-sistema-nps-three.vercel.app/nps`
- `NPS_DISPATCH_ENABLED=true`
- `NPS_DISPATCH_WINDOW_START=08:00`
- `NPS_DISPATCH_WINDOW_END=18:00`
- `NPS_DISPATCH_INTERVAL_SECONDS=45`
- `NPS_MAX_DAILY_PER_SESSION=300`
- `NPS_DUPLICATE_BLOCK_HOURS=24`
- `WHATSAPP_API_URL`
- `WHATSAPP_API_KEY`

## Subida local / VPS

### Backend principal

```bash
cd backend
npm install
npm start
```

### Robô Ecuro

```bash
cd backend
npm install
npm run robot:install-browser
npm run robot:server
```

## PM2

```bash
pm2 start npm --name meu-sistema-nps-backend -- run start
pm2 start npm --name ecuro-robot-service -- run robot:server
pm2 save
```

## Docker

Exemplo de entrypoints:

- backend principal: `node server.js`
- robô Ecuro: `node robot/ecuroRobotServer.js`

Antes de subir a imagem do robô, instalar o Chromium do Playwright:

```bash
npx playwright install chromium
```

## Endpoints internos do robô

Todos exigem `x-api-key: ECURO_ROBOT_API_KEY`.

- `GET /health`
- `POST /ecuro/login-test`
- `POST /ecuro/check-completed`
- `POST /ecuro/check-completed/batch`
- `GET /ecuro/jobs`
- `GET /ecuro/jobs/:id`
- `POST /ecuro/jobs/:id/retry`

## Checklist de homologação

1. Validar `GET /health` do robô.
2. Executar `POST /ecuro/login-test`.
3. Rodar `POST /ecuro/check-completed` com clínica e data controladas.
4. Confirmar gravação em `ecuro_robot_jobs`.
5. Confirmar gravação em `ecuro_patient_completion_status`.
6. Validar criação de `nps_invites`.
7. Com `ECURO_ROBOT_DRY_RUN=true`, confirmar que nenhum WhatsApp é enviado.
8. Com `ECURO_ROBOT_DRY_RUN=false`, validar envio unitário pela sessão `NPS_WHATSAPP_SESSION_ID`.
9. Abrir o link público e confirmar que a resposta grava no painel NPS.
10. Verificar se nenhum item foi criado indevidamente no módulo de reclamações.
