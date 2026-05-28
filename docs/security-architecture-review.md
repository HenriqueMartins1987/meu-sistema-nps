# Revisao tecnica de seguranca e arquitetura

Data: 2026-05-28

## Escopo analisado

- Frontend: React/CRA com rotas autenticadas em `frontend/src/App.js`, layout interno em `frontend/src/AuthenticatedLayout.jsx`, cliente HTTP central em `frontend/src/api.js` e sessao local em `frontend/src/session.js`.
- Backend: Express monolitico em `backend/server.js`, banco MySQL via `mysql2/promise`, Socket.IO, uploads locais/persistidos, servicos de e-mail, WhatsApp/Evolution/VPS, Twilio e inteligencia financeira em `backend/services`.
- Autenticacao: login JWT, middleware `authenticate`, `optionalAuthenticate`, validacao de usuario ativo, `token_version`, permissoes por tela/acao e escopo por clinicas.
- Banco: schema evoluido no boot por `ensureDatabaseSchema()`, com tabelas operacionais de reclamacoes, NPS, usuarios, clinicas, parceiros, WhatsApp, Dental Card, auditoria operacional e logs.
- Integracoes: MySQL/Railway por variaveis de ambiente, WhatsApp por Evolution/VPS, Twilio opcional, e-mail por servico dedicado, deploy frontend Vercel e backend Render.

## Melhorias implementadas

- JWT agora possui expiracao configuravel por `JWT_EXPIRES_IN` e issuer configuravel por `JWT_ISSUER`.
- Autenticacao passou a retornar codigos padronizados para token ausente, invalido, expirado, sessao invalidada e permissao negada.
- Middleware de autorizacao central agora registra acesso negado em auditoria de seguranca sem expor token, senha ou payload sensivel.
- Login recebeu rate limit dedicado, auditoria de sucesso/falha/bloqueio e mensagens mais especificas no frontend.
- Webhooks e exportacoes receberam rate limit especifico para reduzir abuso e risco de indisponibilidade.
- Logout ganhou endpoint auditado (`POST /logout`) sem invalidar sessoes de outros dispositivos.
- Foi criada a tabela `security_audit_logs` para trilha de auditoria append-only por aplicacao.
- Foi criada a tabela `companies` e preparada a coluna `company_id` em entidades operacionais para evolucao multiempresa sem quebrar o modelo atual.
- Foram criadas estruturas preparatorias desativadas para API mobile/futura integracao (`api_clients`) e motor de IA (`ai_analysis_jobs`).
- Logs de auditoria e atividade ganharam mascaramento maior para e-mail, telefone, CPF/documentos, tokens, senhas, chaves e credenciais.
- Frontend passou a diferenciar falha de conexao, timeout, 401, 403, validacao e erro interno, evitando a mensagem generica de API expirada para qualquer falha.
- `ProtectedRoute` agora reage ao evento global de sessao expirada disparado pelo cliente HTTP.

## Migration criada

- `backend/migrations/2026-05-28-security-foundation.sql`

Observacao: o backend tambem aplica a mesma fundacao de schema em `ensureDatabaseSchema()` durante o boot. A migration fica como artefato versionado para execucao controlada/manual, se necessario.

## Variaveis novas opcionais

- `JWT_EXPIRES_IN`: duracao do JWT. Padrao: `8h`.
- `JWT_ISSUER`: emissor logico do JWT. Padrao: `meu-sistema-nps`.
- `DEFAULT_COMPANY_NAME`: nome da empresa padrao. Padrao: `Grupo Sorria`.
- `LOGIN_RATE_LIMIT_WINDOW_MS`: janela do rate limit de login. Padrao: `900000`.
- `LOGIN_RATE_LIMIT_MAX`: maximo de tentativas de login na janela. Padrao: `8`.
- `WEBHOOK_RATE_LIMIT_WINDOW_MS`: janela de rate limit dos webhooks. Padrao: `60000`.
- `WEBHOOK_RATE_LIMIT_MAX`: maximo de chamadas de webhook na janela. Padrao: `600`.
- `EXPORT_RATE_LIMIT_WINDOW_MS`: janela de rate limit de exportacoes. Padrao: `900000`.
- `EXPORT_RATE_LIMIT_MAX`: maximo de exportacoes na janela. Padrao: `30`.

## Pontos sensiveis encontrados

- `JWT_SECRET` precisa estar fixo em producao. Sem isso, cada deploy/restart invalida sessoes e reduz previsibilidade operacional.
- O frontend ainda usa `localStorage` para token. Funciona hoje, mas o proximo passo recomendado e migrar para cookie `HttpOnly/Secure/SameSite` com refresh token controlado.
- A preparacao multiempresa adiciona `company_id`, mas a aplicacao ainda usa principalmente escopo por `clinic_id/user_clinics`. A ativacao completa de multitenancy deve ser feita modulo por modulo.
- O schema ainda depende bastante de `ensureDatabaseSchema()` no boot. Recomendado migrar gradualmente para migrations executadas por pipeline/operacao controlada.
- Credenciais e chaves devem permanecer somente em environment variables; nenhum `.env` deve ser versionado.

## Backup e recuperacao

Antes de qualquer migration em producao:

1. Gerar backup do MySQL/Railway.
2. Registrar horario, ambiente, commit e responsavel.
3. Validar que o backup foi concluido com sucesso.
4. Executar migration/boot em janela de menor uso.
5. Validar login, healthcheck, dashboards e fluxo WhatsApp.

Rollback recomendado:

1. Reverter o deploy para o commit anterior.
2. Se a migration ja foi aplicada, manter colunas/tabelas novas quando forem aditivas e nao quebrarem a versao anterior.
3. Restaurar backup somente se houver corrupcao de dados ou alteracao destrutiva. As alteracoes atuais sao aditivas.

## LGPD e auditoria

- Auditoria registra usuario, perfil, IP, modulo, acao, resultado, registro afetado, origem e valores mascarados quando aplicavel.
- Dados pessoais em logs sao reduzidos/mascarados por padrao.
- Recomendado formalizar telas/fluxos de consentimento, politica de privacidade, exportacao do titular e retencao/anonimizacao por regra juridica aprovada.

## Preparacao mobile e IA

- `api_clients` prepara credenciais de integracao para futuro app/PWA/API externa, inicialmente inativo.
- `ai_analysis_jobs` prepara persistencia de jobs de IA, inicialmente com status `disabled`.
- Nenhuma IA foi ativada automaticamente nesta revisao.

## Checklist de testes usado

- Analise estatica do backend com `node --check`.
- Testes automatizados do backend com `npm test`.
- Build de producao do frontend com `npm run build`.
- Validacao de healthcheck apos deploy.
- Validacao de acesso protegido sem token retornando 401 padronizado.

## Recomendacoes futuras

- Separar `server.js` em modulos: auth, RBAC, audit, complaints, NPS, WhatsApp, reports e schema/migrations.
- Criar migrations obrigatorias no pipeline antes do boot de producao.
- Implementar refresh token com rotacao e cookie seguro.
- Evoluir RBAC para matriz persistida em banco, com UI de permissao auditada.
- Completar multitenancy com `company_id` obrigatorio nos filtros de todas as queries operacionais.
- Criar testes automatizados de permissao por perfil e por unidade/empresa.
