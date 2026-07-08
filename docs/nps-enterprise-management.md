# NPS Enterprise Management

## Objetivo

Evoluir o módulo NPS existente para uma camada de gestão executiva e operacional sem alterar a integração Ecuro → WhatsApp → resposta → persistência já homologada.

## Regra NPS

Classificação única e imutável:

- 0 a 6: detrator;
- 7 e 8: neutro;
- 9 e 10: promotor.

Fórmula:

`NPS = (% de promotores) - (% de detratores)`

O denominador contém apenas respostas válidas. Convites enviados e não respondidos entram na taxa de resposta, mas nunca no cálculo do NPS.

## Componentes implementados

### Backend

- `services/npsEnterpriseService.js`
  - classificação NPS;
  - cálculo de NPS e taxa de resposta;
  - taxa de recuperação;
  - SLA;
  - prioridade operacional;
  - índice de risco de experiência;
  - ranking por entidade;
  - Pareto de causas.

- `routes/npsEnterpriseRoutes.js`
  - taxonomia de causas;
  - atualização gerencial;
  - prorrogação justificada de SLA;
  - timeline gerencial.

- `routes/npsEnterpriseStandaloneRouter.js`
  - adaptador de montagem isolada;
  - pool de banco dedicado e limitado;
  - autenticação JWT;
  - autorização por perfil.

### Banco

Migration:

`migrations/2026-07-08-nps-enterprise-management.sql`

Inclui:

- campos de prioridade, SLA, causa, recuperação e risco em `nps_responses`;
- `nps_management_events`;
- `nps_sla_extensions`;
- `nps_cause_taxonomy`;
- `nps_goals`;
- `nps_alerts`;
- evolução de `nps_referrals`.

### Frontend

- `NpsDashboard.js`: cockpit executivo;
- `NpsManagement.js`: central operacional;
- `npsEnterpriseAnalytics.js`: cálculos e derivação visual;
- `NpsEnterprise.css`: sistema visual responsivo.

## Indicadores executivos

- NPS;
- respostas válidas;
- taxa de resposta;
- promotores;
- neutros;
- detratores;
- detratores pendentes;
- conformidade de SLA;
- taxa de reversão;
- indicações e conversão;
- índice de risco de experiência;
- ranking de clínicas;
- Pareto de causas;
- tendência temporal.

## Gestão operacional

A Central Operacional permite:

- priorização separada da classificação NPS;
- controle de SLA;
- substatus operacional;
- responsável;
- classificação de causa e subcausa;
- causa raiz;
- recuperação do detrator;
- registro de tratativa;
- timeline e auditoria;
- prorrogação de SLA com justificativa;
- migração para reclamação quando necessário.

## Política de implantação

A implantação deve ocorrer em quatro etapas:

1. backup de fonte e dados;
2. aplicação da migration;
3. montagem da rota enterprise no backend principal;
4. build e homologação do frontend.

Durante a homologação devem permanecer:

- `NPS_TEST_MODE=true`;
- `NPS_DISPATCH_ENABLED=false`;
- `ECURO_ROBOT_DRY_RUN=true`.

A implantação do módulo de gestão não exige ativação de disparo NPS.

## Rollback

O rollback de aplicação é feito retornando ao commit/branch anterior e removendo a montagem da rota enterprise. A migration foi desenhada para ser aditiva; não deve ser revertida apagando dados em produção. Em caso de rollback de aplicação, manter as tabelas e colunas até janela de manutenção específica.

## Homologação mínima

1. executar testes unitários do backend;
2. validar build do frontend;
3. abrir Dashboard NPS;
4. validar fórmula com amostra conhecida;
5. abrir Central Operacional;
6. validar detrator com prioridade e SLA;
7. salvar causa, responsável e tratativa;
8. validar timeline;
9. prorrogar SLA com justificativa;
10. validar promotor e indicação;
11. validar neutro sem fila de detrator;
12. validar RBAC.
