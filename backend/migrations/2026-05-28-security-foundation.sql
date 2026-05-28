CREATE TABLE IF NOT EXISTS companies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  trade_name VARCHAR(180) NULL,
  document_number VARCHAR(40) NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_companies_name (name),
  INDEX idx_companies_status (status)
);

INSERT INTO companies (id, name, trade_name, status)
VALUES (1, 'Grupo Sorria', 'Grupo Sorria', 'active')
ON DUPLICATE KEY UPDATE name = VALUES(name), trade_name = COALESCE(trade_name, VALUES(trade_name)), status = VALUES(status);

CREATE TABLE IF NOT EXISTS security_audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NULL DEFAULT 1,
  actor_user_id INT NULL,
  actor_name VARCHAR(180) NULL,
  actor_email VARCHAR(220) NULL,
  actor_role VARCHAR(80) NULL,
  module VARCHAR(80) NOT NULL,
  action VARCHAR(120) NOT NULL,
  outcome VARCHAR(40) NOT NULL DEFAULT 'success',
  record_type VARCHAR(80) NULL,
  record_id VARCHAR(80) NULL,
  previous_value JSON NULL,
  new_value JSON NULL,
  metadata JSON NULL,
  ip_address VARCHAR(80) NULL,
  user_agent VARCHAR(500) NULL,
  origin VARCHAR(40) NOT NULL DEFAULT 'system',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_security_audit_company_created (company_id, created_at),
  INDEX idx_security_audit_actor_created (actor_user_id, created_at),
  INDEX idx_security_audit_module_action (module, action),
  INDEX idx_security_audit_record (record_type, record_id)
);

CREATE TABLE IF NOT EXISTS api_clients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NULL DEFAULT 1,
  name VARCHAR(180) NOT NULL,
  client_key_hash VARCHAR(255) NOT NULL,
  scopes JSON NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'inactive',
  created_by INT NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_api_clients_key_hash (client_key_hash),
  INDEX idx_api_clients_company_status (company_id, status)
);

CREATE TABLE IF NOT EXISTS ai_analysis_jobs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NULL DEFAULT 1,
  module VARCHAR(80) NOT NULL,
  source_record_type VARCHAR(80) NULL,
  source_record_id VARCHAR(80) NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'disabled',
  requested_by_user_id INT NULL,
  input_hash VARCHAR(80) NULL,
  result_payload JSON NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  INDEX idx_ai_jobs_company_status (company_id, status),
  INDEX idx_ai_jobs_source (source_record_type, source_record_id)
);

DELIMITER $$

CREATE PROCEDURE add_company_column_if_needed(IN p_table VARCHAR(64))
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table
  ) THEN
    IF NOT EXISTS (
      SELECT 1
        FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = p_table
         AND COLUMN_NAME = 'company_id'
    ) THEN
      SET @sql_add_company = CONCAT('ALTER TABLE `', REPLACE(p_table, '`', '``'), '` ADD COLUMN company_id INT NULL DEFAULT 1');
      PREPARE stmt_add_company FROM @sql_add_company;
      EXECUTE stmt_add_company;
      DEALLOCATE PREPARE stmt_add_company;
    END IF;

    SET @sql_update_company = CONCAT('UPDATE `', REPLACE(p_table, '`', '``'), '` SET company_id = 1 WHERE company_id IS NULL');
    PREPARE stmt_update_company FROM @sql_update_company;
    EXECUTE stmt_update_company;
    DEALLOCATE PREPARE stmt_update_company;
  END IF;
END$$

CREATE PROCEDURE add_company_index_if_needed(IN p_table VARCHAR(64), IN p_index VARCHAR(64))
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table
  ) AND NOT EXISTS (
    SELECT 1
      FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = p_table
       AND INDEX_NAME = p_index
  ) THEN
    SET @sql_add_index = CONCAT('CREATE INDEX `', REPLACE(p_index, '`', '``'), '` ON `', REPLACE(p_table, '`', '``'), '` (company_id)');
    PREPARE stmt_add_index FROM @sql_add_index;
    EXECUTE stmt_add_index;
    DEALLOCATE PREPARE stmt_add_index;
  END IF;
END$$

DELIMITER ;

CALL add_company_column_if_needed('clinics');
CALL add_company_column_if_needed('users');
CALL add_company_column_if_needed('user_clinics');
CALL add_company_column_if_needed('complaints');
CALL add_company_column_if_needed('complaint_logs');
CALL add_company_column_if_needed('complaint_evidences');
CALL add_company_column_if_needed('nps_responses');
CALL add_company_column_if_needed('nps_treatment_logs');
CALL add_company_column_if_needed('patient_interactions');
CALL add_company_column_if_needed('patient_interaction_logs');
CALL add_company_column_if_needed('whatsapp_instances');
CALL add_company_column_if_needed('whatsapp_messages');
CALL add_company_column_if_needed('whatsapp_conversations');
CALL add_company_column_if_needed('whatsapp_dispatch_queue');
CALL add_company_column_if_needed('whatsapp_campaign_recipients');
CALL add_company_column_if_needed('whatsapp_service_sessions');
CALL add_company_column_if_needed('whatsapp_service_history');
CALL add_company_column_if_needed('partner_video_partners');
CALL add_company_column_if_needed('partner_video_send_logs');
CALL add_company_column_if_needed('system_activity_logs');
CALL add_company_column_if_needed('security_audit_logs');

CALL add_company_index_if_needed('clinics', 'idx_clinics_company_id');
CALL add_company_index_if_needed('users', 'idx_users_company_id');
CALL add_company_index_if_needed('complaints', 'idx_complaints_company_id');
CALL add_company_index_if_needed('nps_responses', 'idx_nps_responses_company_id');
CALL add_company_index_if_needed('patient_interactions', 'idx_patient_interactions_company_id');
CALL add_company_index_if_needed('whatsapp_instances', 'idx_whatsapp_instances_company_id');
CALL add_company_index_if_needed('whatsapp_dispatch_queue', 'idx_whatsapp_dispatch_queue_company_id');
CALL add_company_index_if_needed('partner_video_partners', 'idx_partner_video_partners_company_id');
CALL add_company_index_if_needed('system_activity_logs', 'idx_system_activity_logs_company_id');
CALL add_company_index_if_needed('security_audit_logs', 'idx_security_audit_logs_company_id');

DROP PROCEDURE add_company_index_if_needed;
DROP PROCEDURE add_company_column_if_needed;
