ALTER TABLE dental_card_leads
  ADD COLUMN IF NOT EXISTS vinculo_indicador VARCHAR(120) NULL AFTER nome_indicador,
  ADD COLUMN IF NOT EXISTS email VARCHAR(220) NULL AFTER vinculo_indicador,
  ADD COLUMN IF NOT EXISTS responsavel_cadastro VARCHAR(180) NULL AFTER email,
  ADD COLUMN IF NOT EXISTS foto_url VARCHAR(500) NULL AFTER responsavel_cadastro,
  ADD COLUMN IF NOT EXISTS origem_cadastro VARCHAR(160) NULL AFTER foto_url,
  ADD COLUMN IF NOT EXISTS ip_origem VARCHAR(80) NULL AFTER origem_cadastro,
  ADD COLUMN IF NOT EXISTS user_agent VARCHAR(500) NULL AFTER ip_origem,
  ADD COLUMN IF NOT EXISTS link_origem VARCHAR(500) NULL AFTER user_agent,
  ADD COLUMN IF NOT EXISTS unidade_slug VARCHAR(180) NULL AFTER link_origem,
  ADD COLUMN IF NOT EXISTS data_status DATETIME NULL AFTER unidade_slug,
  ADD COLUMN IF NOT EXISTS public_form_token VARCHAR(120) NULL AFTER data_status,
  ADD COLUMN IF NOT EXISTS created_via_public_form TINYINT(1) NOT NULL DEFAULT 0 AFTER public_form_token,
  ADD COLUMN IF NOT EXISTS data_limite_retorno DATETIME NULL AFTER created_via_public_form,
  ADD COLUMN IF NOT EXISTS primeiro_retorno_em DATETIME NULL AFTER data_limite_retorno,
  ADD COLUMN IF NOT EXISTS sla_retorno_status VARCHAR(40) NOT NULL DEFAULT 'pendente' AFTER primeiro_retorno_em;

CREATE TABLE IF NOT EXISTS dental_card_attachments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  file_name VARCHAR(255) NULL,
  file_url VARCHAR(500) NOT NULL,
  file_type VARCHAR(120) NULL,
  file_size INT NULL,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  uploaded_by VARCHAR(180) NULL,
  source VARCHAR(80) NULL,
  INDEX idx_dental_attachment_lead (lead_id),
  CONSTRAINT fk_dental_attachment_lead FOREIGN KEY (lead_id) REFERENCES dental_card_leads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dental_card_notification_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  recebe_notificacao_sistema TINYINT(1) NOT NULL DEFAULT 1,
  recebe_notificacao_whatsapp TINYINT(1) NOT NULL DEFAULT 0,
  telefone_whatsapp VARCHAR(40) NULL,
  unidade VARCHAR(180) NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_dental_notification_user_unit (user_id, unidade),
  INDEX idx_dental_notification_user (user_id),
  INDEX idx_dental_notification_unit (unidade)
);

CREATE TABLE IF NOT EXISTS dental_card_notification_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NULL,
  user_id INT NULL,
  tipo_notificacao VARCHAR(80) NOT NULL,
  canal VARCHAR(40) NOT NULL,
  mensagem TEXT NULL,
  status_envio VARCHAR(80) NOT NULL,
  data_envio DATETIME NULL,
  erro TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_dental_notification_log_lead (lead_id),
  INDEX idx_dental_notification_log_user (user_id),
  INDEX idx_dental_notification_log_status (status_envio)
);
