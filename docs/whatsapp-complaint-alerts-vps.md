# Alertas de reclamações por WhatsApp na VPS

## Objetivo

Quando uma nova reclamação é cadastrada, o backend envia o alerta ao coordenador e ao gerente da unidade usando exclusivamente a sessão `reclamacoes` do `whatsapp-service` hospedado na VPS.

A aba **Gestão WhatsApp CRC > Alertas de Reclamações** centraliza:

- ativação por unidade;
- seleção de coordenador e gerente vinculados;
- telefone operacional de cada destinatário;
- teste controlado;
- saúde da sessão `reclamacoes`;
- histórico por protocolo, destinatário e status.

## Arquitetura

1. O cadastro grava a reclamação e gera o protocolo.
2. O backend resolve a configuração da unidade em `complaint_whatsapp_alert_settings`.
3. Sem configuração salva, o sistema mantém compatibilidade e usa os vínculos de `user_clinics`.
4. Os alertas `COMPLAINT_*` são obrigatoriamente enviados pelo `whatsapp-service`; não há fallback silencioso para outro provedor.
5. Cada tentativa é registrada em `notification_logs` e no histórico do serviço WhatsApp.
6. A VPS recebe uma chave de idempotência para reduzir risco de mensagens duplicadas.

## Variáveis obrigatórias

Configure no ambiente do backend:

```env
WHATSAPP_SYSTEM_NOTIFICATIONS_PROVIDER=whatsapp_service
WHATSAPP_API_URL=https://whatsapp.example.com
WHATSAPP_API_KEY=uma-chave-longa-e-exclusiva
WHATSAPP_NOTIFICATION_SENDER_PHONE=5562999999999
```

Nunca versionar a chave. O arquivo `backend/.env.example` contém somente nomes e exemplos seguros.

## VPS

Requisitos recomendados:

- domínio exclusivo para o serviço;
- HTTPS com certificado válido;
- porta interna do serviço não exposta diretamente à internet;
- Nginx ou Caddy como reverse proxy;
- firewall permitindo somente `80/443` e acesso administrativo restrito;
- processo supervisionado por Docker ou systemd;
- diretório persistente e backup das sessões;
- logs com rotação e monitoramento de disco/memória;
- chave `x-api-key` com pelo menos 32 bytes aleatórios.

Exemplo mínimo de proxy Nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name whatsapp.example.com;

    location / {
        proxy_pass http://127.0.0.1:3005;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 60s;
    }
}
```

## Implantação

1. Fazer backup do MySQL.
2. Aplicar `backend/migrations/2026-06-15-complaint-whatsapp-alerts.sql`.
3. Configurar as variáveis do backend.
4. Publicar backend e frontend.
5. Confirmar que a sessão `reclamacoes` aparece como `conectado`.
6. Abrir a nova aba e completar as unidades marcadas como `Cadastro incompleto`.
7. Usar **Testar envio** em uma unidade controlada.
8. Cadastrar uma reclamação de homologação e confirmar o histórico.

## Operação e segurança

- O teste envia mensagem real e exige confirmação na interface.
- Usuários selecionados precisam estar ativos e vinculados à unidade.
- O perfil precisa ser compatível com coordenador ou gerente.
- Telefones são normalizados para o padrão brasileiro com DDI `55`.
- Reclamações não usam credencial embutida no código.
- Falha da VPS não bloqueia a criação do protocolo; a falha fica auditada para correção e reenvio.

## Rollback

As alterações de banco são aditivas. Para rollback:

1. retornar o deploy ao commit anterior;
2. manter a tabela nova, pois ela não interfere na versão anterior;
3. restaurar backup somente em caso de corrupção, não por simples rollback de aplicação.
