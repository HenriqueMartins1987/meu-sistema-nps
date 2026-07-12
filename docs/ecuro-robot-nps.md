# Robô Ecuro / NPS Automática

## Visão geral

O fluxo automático de NPS consulta o Ecuro por navegador, abre diretamente `https://ecuro.com.br/dashboard/patients` e usa a coluna `ÚLTIMA CONSULTA` como regra principal de elegibilidade.

Regra atual:

- o robô autentica em dois níveis;
- navega para `/dashboard/patients`;
- identifica a clínica selecionada no topo;
- coleta a tabela de pacientes;
- considera elegível somente quem possui `ÚLTIMA CONSULTA = ontem` no fuso `America/Sao_Paulo`;
- cria convites NPS com `source=ecuro_last_consultation`;
- envia pelo WhatsApp da VPS usando `whatsappProvider.sendText()`;
- recebe respostas pelo link público e também por resposta direta no WhatsApp.

Camadas:

- `backend/robot/ecuroRobotServer.js`: API interna protegida do robô.
- `backend/services/ecuroRobotService.js`: Playwright, login, navegação, leitura da tabela e elegibilidade.
- `backend/services/ecuroCompletionService.js`: integração com backend principal, link público, janela de envio e idempotência.
- `backend/server.js`: orquestração, fila de convites, auditoria e webhook inbound.

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
- `ECURO_ROBOT_SERVICE_URL=http://2.24.101.6:3010`
- `ECURO_ROBOT_SERVICE_TIMEOUT_MS=60000`
- `ECURO_ROBOT_CRON=0 19 * * 1-6`
- `ECURO_ROBOT_DRY_RUN=true`
- `ECURO_ROBOT_VISUAL_MODE=false`
- `ECURO_ROBOT_VNC_ENABLED=false`
- `ECURO_ROBOT_VNC_HOST=127.0.0.1`
- `ECURO_ROBOT_VNC_PORT=6080`
- `ECURO_ROBOT_CAPTURE_INTERVAL_SECONDS=5`
- `ECURO_MAX_PAGES_PER_RUN=20`
- `ECURO_MAX_PATIENTS_PER_RUN=1000`
- `ECURO_STOP_WHEN_OLDER_THAN_TARGET=true`
- `ECURO_MAPPING_ENABLED=false`
- `ECURO_MAPPING_CRON=0 2 * * *`
- `ECURO_MAPPING_MAX_PAGES=10`
- `ECURO_MAPPING_MAX_DEPTH=3`
- `ECURO_MAPPING_CAPTURE_SCREENSHOTS=true`
- `ECURO_MAPPING_CAPTURE_HTML=true`
- `ECURO_MAPPING_READ_ONLY=true`
- `NPS_WHATSAPP_SESSION_ID=nps`
- `NPS_PUBLIC_URL=https://meu-sistema-nps-three.vercel.app/nps`
- `NPS_DISPATCH_ENABLED=false`
- `NPS_DISPATCH_WINDOW_START=08:00`
- `NPS_DISPATCH_WINDOW_END=18:00`
- `NPS_DISPATCH_INTERVAL_SECONDS=45`
- `NPS_MAX_DAILY_PER_SESSION=300`
- `NPS_DUPLICATE_BLOCK_HOURS=24`
- `WHATSAPP_API_URL`
- `WHATSAPP_API_KEY`
- `BACKEND_INBOUND_WEBHOOK_SECRET`

## Endpoints internos

### Robô Ecuro

Todos exigem `x-api-key: ECURO_ROBOT_API_KEY`.

- `GET /health`
- `POST /ecuro/login-test`
- `POST /ecuro/check-completed`
- `POST /ecuro/check-completed/batch`
- `POST /ecuro/mapping/run`
- `GET /ecuro/jobs`
- `GET /ecuro/jobs/:id`
- `POST /ecuro/jobs/:id/retry`
- `GET /ecuro/live-state`
- `GET /ecuro/vnc-status`
- `POST /ecuro/vnc/start`
- `POST /ecuro/vnc/stop`

### Backend principal

- `GET /nps/automation/overview`
- `POST /nps/automation/test-login`
- `POST /nps/automation/run`
- `POST /nps/automation/reprocess-failures`
- `POST /nps/public`
- `POST /nps/whatsapp/inbound`
- `GET /admin/robot/master/overview`
- `GET /admin/robot/master/jobs`
- `GET /admin/robot/master/jobs/:id`
- `GET /admin/robot/master/logs`
- `GET /admin/robot/master/artifacts`
- `GET /admin/robot/master/mapping`
- `GET /admin/robot/master/mapping/pages`
- `POST /admin/robot/master/run-nps-dry-run`
- `POST /admin/robot/master/run-nps-send`
- `POST /admin/robot/master/run-mapping`
- `POST /admin/robot/master/reprocess-job`
- `GET /admin/robot/master/vnc-status`
- `POST /admin/robot/master/vnc/start`
- `POST /admin/robot/master/vnc/stop`

## Monitor Master do Robo Ecuro

Tela exclusiva:

- rota frontend: `/admin/robot-master`
- acesso: somente `master_admin`
- backend: `/admin/robot/master/*`

O monitor mostra:

- status do robo, ultima e proxima execucao;
- KPIs de leitura, elegibilidade, envio, resposta, falhas e duplicidades;
- jobs detalhados com payload, logs, artefatos, convites e respostas;
- execucao em tempo real por polling;
- resumo e inventario do mapeamento noturno;
- status VNC ou fallback por screenshot/HTML.

## Estado inicial seguro

Configurar inicialmente:

- `ECURO_ROBOT_DRY_RUN=true`
- `NPS_DISPATCH_ENABLED=false`
- `ECURO_MAPPING_ENABLED=false`
- `ECURO_MAPPING_MAX_PAGES=10`
- `ECURO_ROBOT_VNC_ENABLED=false`

Somente apos homologacao:

- ativar `NPS_DISPATCH_ENABLED=true`
- reduzir ou remover limites conservadores do mapeamento
- habilitar VNC apenas se houver reverse proxy seguro e autenticado

## Webhook inbound do WhatsApp

Quando o `whatsapp-service` receber mensagem do paciente, ele deve chamar:

```text
POST /nps/whatsapp/inbound
```

Headers:

- `x-webhook-secret: BACKEND_INBOUND_WEBHOOK_SECRET`

Payload mínimo:

```json
{
  "sessionId": "nps",
  "phone": "+5562999999999",
  "message": "10",
  "messageId": "wamid-123",
  "timestamp": "2026-06-30T14:15:00-03:00"
}
```

Comportamento:

- se a mensagem for `0` a `10`, cria a resposta NPS;
- se vier texto depois da nota, grava comentário complementar;
- deduplica por `messageId`;
- atualiza `nps_invites` para `responded`.

## Checklist de homologação

1. Validar `GET /health` do backend principal.
2. Validar `GET /health` do robô Ecuro.
3. Executar `POST /nps/automation/test-login`.
4. Rodar `POST /nps/automation/run` com `ECURO_ROBOT_DRY_RUN=true`.
5. Confirmar leitura da clínica e da coluna `ÚLTIMA CONSULTA`.
6. Confirmar totais de elegíveis, fora da data, sem telefone e duplicados.
7. Validar gravação em `ecuro_robot_jobs`.
8. Validar gravação em `ecuro_patient_completion_status`.
9. Confirmar criação de `nps_invites` apenas para elegíveis com telefone válido.
10. Desativar o dry-run e fazer envio unitário controlado.
11. Abrir o link público e confirmar a gravação em `nps_responses`.
12. Responder também pelo WhatsApp e confirmar atualização do mesmo convite.
13. Verificar se nenhuma reclamação foi criada indevidamente.
