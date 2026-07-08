-- ============================================================
-- NPS Enterprise Management Layer
-- Data: 2026-07-08
-- Objetivo: gestão de SLA, prioridade, causa, recuperação,
-- metas, alertas, indicações e trilha de auditoria.
-- Migração idempotente para MySQL 8+
-- ============================================================

ALTER TABLE nps_responses
  ADD COLUMN IF NOT EXISTS operational_priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS management_substatus VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS cause_category VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS cause_subcategory VARCHAR(160) NULL,
  ADD COLUMN IF NOT EXISTS root_cause TEXT NULL,
  ADD COLUMN IF NOT EXISTS responsible_user_id INT NULL,
  ADD COLUMN IF NOT EXISTS responsible_name VARCHAR(180) NULL,
  ADD COLUMN IF NOT EXISTS sla_due_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS sla_status VARCHAR(30) NULL,
  ADD COLUMN IF NOT EXISTS first_action_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS resolved_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS closed_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS reopened_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS recovery_status VARCHAR(30) NOT NULL DEFAULT 'nao_iniciado',
  ADD COLUMN IF NOT EXISTS recovered_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS recurrence_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS experience_risk_score INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS experience_risk_level VARCHAR(20) NOT NULL DEFAULT 'baixo';

CREATE INDEX IF NOT EXISTS idx_nps_responses_management
  ON nps_responses (nps_status, operational_priority, sla_due_at);

CREATE INDEX IF NOT EXISTS idx_nps_responses_cause
  ON nps_responses (cause_category, cause_subcategory);

CREATE INDEX IF NOT EXISTS idx_nps_responses_recovery
  ON nps_responses (recovery_status, recovered_at);

CREATE TABLE IF NOT EXISTS nps_management_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  nps_response_id INT NOT NULL,
  action VARCHAR(80) NOT NULL,
  event_type VARCHAR(80) NOT NULL DEFAULT 'management',
  previous_value_json LONGTEXT NULL,
  new_value_json LONGTEXT NULL,
  message TEXT NULL,
  actor_user_id INT NULL,
  actor_name VARCHAR(180) NULL,
  actor_role VARCHAR(80) NULL,
  source_ip VARCHAR(80) NULL,
  source_channel VARCHAR(80) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_nps_management_events_response (nps_response_id, created_at),
  INDEX idx_nps_management_events_action (action, created_at)
);

CREATE TABLE IF NOT EXISTS nps_sla_extensions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  nps_response_id INT NOT NULL,
  previous_due_at DATETIME NOT NULL,
  new_due_at DATETIME NOT NULL,
  reason TEXT NOT NULL,
  requested_by_user_id INT NULL,
  requested_by_name VARCHAR(180) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_nps_sla_extensions_response (nps_response_id, created_at)
);

CREATE TABLE IF NOT EXISTS nps_cause_taxonomy (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  category VARCHAR(120) NOT NULL,
  subcategory VARCHAR(160) NOT NULL,
  description TEXT NULL,
  owner_area VARCHAR(160) NULL,
  default_priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 999,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_nps_cause_taxonomy (category, subcategory),
  INDEX idx_nps_cause_taxonomy_active (is_active, sort_order)
);

INSERT IGNORE INTO nps_cause_taxonomy
  (category, subcategory, owner_area, default_priority, sort_order)
VALUES
  ('Atendimento', 'Postura e cordialidade', 'Operacional', 'media', 10),
  ('Espera', 'Tempo de espera na unidade', 'Operacional', 'media', 20),
  ('Agenda', 'Dificuldade de agendamento', 'CRC', 'media', 30),
  ('Comercial', 'Abordagem comercial', 'Comercial', 'media', 40),
  ('Financeiro', 'Cobrança e negociação', 'Financeiro', 'alta', 50),
  ('Tratamento', 'Insatisfação com tratamento', 'Clínico', 'alta', 60),
  ('Resultado clínico', 'Resultado percebido', 'Clínico', 'alta', 70),
  ('Comunicação', 'Falta de informação ou retorno', 'Operacional', 'media', 80),
  ('Orçamento', 'Divergência ou incompreensão', 'Comercial', 'media', 90),
  ('Recepção', 'Atendimento de recepção', 'Operacional', 'media', 100),
  ('Ortodontia', 'Fluxo de ortodontia', 'Ortodontia', 'media', 110),
  ('Implante', 'Fluxo de implante', 'Implante', 'alta', 120),
  ('Prótese', 'Prazo ou adaptação de prótese', 'Prótese', 'alta', 130),
  ('Estrutura', 'Conforto, limpeza ou infraestrutura', 'Administrativo', 'media', 140),
  ('Pós-venda', 'Ausência de acompanhamento', 'CX', 'media', 150),
  ('Outros', 'Não classificado', 'Gestão', 'normal', 999);

CREATE TABLE IF NOT EXISTS nps_goals (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  scope_type VARCHAR(40) NOT NULL,
  scope_id VARCHAR(120) NULL,
  scope_name VARCHAR(180) NULL,
  metric_key VARCHAR(80) NOT NULL,
  target_value DECIMAL(12,4) NOT NULL,
  valid_from DATE NOT NULL,
  valid_until DATE NULL,
  created_by_user_id INT NULL,
  created_by_name VARCHAR(180) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_nps_goals_scope (scope_type, scope_id, metric_key, valid_from),
  INDEX idx_nps_goals_validity (valid_from, valid_until)
);

CREATE TABLE IF NOT EXISTS nps_alerts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  alert_type VARCHAR(80) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'warning',
  nps_response_id INT NULL,
  clinic_id INT NULL,
  clinic_name VARCHAR(180) NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  idempotency_key VARCHAR(180) NOT NULL,
  assigned_user_id INT NULL,
  assigned_name VARCHAR(180) NULL,
  read_at DATETIME NULL,
  resolved_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_nps_alerts_idempotency (idempotency_key),
  INDEX idx_nps_alerts_status (status, severity, created_at),
  INDEX idx_nps_alerts_response (nps_response_id, created_at)
);

CREATE TABLE IF NOT EXISTS nps_referrals (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  nps_response_id INT NULL,
  nps_invite_id BIGINT NULL,
  clinic_id INT NULL,
  clinic_name VARCHAR(180) NULL,
  referrer_patient_name VARCHAR(180) NULL,
  referrer_patient_phone VARCHAR(40) NULL,
  referral_name VARCHAR(180) NULL,
  referral_phone VARCHAR(40) NULL,
  referral_status VARCHAR(40) NOT NULL DEFAULT 'nova',
  responsible_user_id INT NULL,
  responsible_name VARCHAR(180) NULL,
  last_contact_at DATETIME NULL,
  next_action_at DATETIME NULL,
  referral_accepted_at DATETIME NULL,
  referral_received_at DATETIME NULL,
  scheduled_at DATETIME NULL,
  attended_at DATETIME NULL,
  converted_at DATETIME NULL,
  lost_reason TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_nps_referrals_status (referral_status, created_at),
  INDEX idx_nps_referrals_clinic (clinic_id, clinic_name),
  INDEX idx_nps_referrals_response (nps_response_id)
);

ALTER TABLE nps_referrals
  ADD COLUMN IF NOT EXISTS responsible_user_id INT NULL,
  ADD COLUMN IF NOT EXISTS responsible_name VARCHAR(180) NULL,
  ADD COLUMN IF NOT EXISTS last_contact_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS next_action_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS scheduled_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS attended_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS lost_reason TEXT NULL;
