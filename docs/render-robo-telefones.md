# Robô de Telefones no Render

## Serviço

O backend em produção que deve receber as variáveis do robô é o serviço público do Render que responde por:

- `https://meu-sistema-nps-backend.onrender.com`

Na prática, o serviço a acessar no painel do Render é o backend principal do sistema NPS associado a esse domínio.

## Menu no Render

No painel do Render:

1. Abra o serviço do backend.
2. Entre em `Environment`.
3. Cadastre ou atualize as variáveis abaixo.
4. Salve.

## Variáveis obrigatórias

```env
EXTERNAL_PORTAL_LEVEL1_USERNAME=
EXTERNAL_PORTAL_LEVEL1_PASSWORD=
EXTERNAL_PORTAL_LEVEL2_USERNAME=
EXTERNAL_PORTAL_LEVEL2_PASSWORD=
EXTERNAL_PORTAL_BASE_URL=https://ecuro.com.br
ROBOT_HEADLESS=true
ROBOT_TIMEOUT_MS=60000
ROBOT_MAX_ATTEMPTS=3
ROBOT_ENABLE_AUTO_AFTER_UPLOAD=true
WHATSAPP_OPEN_MODE=web
WHATSAPP_DEFAULT_COUNTRY_CODE=55
```

## Redeploy

Depois de salvar as variáveis, faça um redeploy do serviço no Render.

Opção mais segura:

1. `Manual Deploy`
2. `Deploy latest commit`

## O que já está preparado no código

- O frontend continua apontando para o backend atual do Render via [frontend/vercel.json](C:/Users/zyckh/OneDrive/Desktop/meu-sistema-nps/frontend/vercel.json).
- O robô lê credenciais apenas por variáveis de ambiente.
- O upload/importação da agenda cria fila automática de enriquecimento para itens pendentes.
- O backend valida operador, clínica e data do agendamento antes de enriquecer contato.
- O card da agenda já mostra status de contato e já possui ação para abrir WhatsApp quando permitido.

## Endpoints para teste após configurar as variáveis

Use o backend do Render já autenticado no sistema:

- `GET /api/health`
- `GET /api/agenda/enrichment/overview`
- `POST /api/agenda/enrichment/run`

Exemplos completos:

- `https://meu-sistema-nps-backend.onrender.com/api/health`
- `https://meu-sistema-nps-backend.onrender.com/api/agenda/enrichment/overview`
- `https://meu-sistema-nps-backend.onrender.com/api/agenda/enrichment/run`

## Validação funcional recomendada

1. Importar uma agenda com pacientes sem telefone.
2. Confirmar a mensagem de sucesso da importação.
3. Abrir a agenda e validar os indicadores de enriquecimento.
4. Executar `Buscar telefones agora` se houver pendências.
5. Conferir o status do contato no card do agendamento.
6. Conferir o botão `Abrir WhatsApp` em um item com telefone válido.
