CREATE TABLE IF NOT EXISTS complaint_whatsapp_alert_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  clinic_id INT NOT NULL UNIQUE,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  notify_coordinator TINYINT(1) NOT NULL DEFAULT 1,
  notify_manager TINYINT(1) NOT NULL DEFAULT 1,
  coordinator_user_id INT NULL,
  coordinator_name VARCHAR(180) NULL,
  coordinator_phone VARCHAR(40) NULL,
  manager_user_id INT NULL,
  manager_name VARCHAR(180) NULL,
  manager_phone VARCHAR(40) NULL,
  session_id VARCHAR(120) NOT NULL DEFAULT 'reclamacoes',
  updated_by VARCHAR(180) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_complaint_whatsapp_alerts_enabled (enabled),
  INDEX idx_complaint_whatsapp_alerts_session (session_id)
);
