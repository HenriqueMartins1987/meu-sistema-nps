CREATE TABLE IF NOT EXISTS nps_twilio_conversations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  conversation_id VARCHAR(120) NOT NULL,
  nps_invite_id BIGINT NULL,
  nps_response_id INT NULL,
  patient_name VARCHAR(180) NULL,
  patient_phone VARCHAR(40) NULL,
  patient_phone_normalized VARCHAR(40) NULL,
  clinic_id INT NULL,
  clinic_name VARCHAR(180) NULL,
  provider VARCHAR(40) NOT NULL DEFAULT 'TWILIO',
  source VARCHAR(80) NOT NULL DEFAULT 'twilio_nps_demo',
  state VARCHAR(80) NOT NULL DEFAULT 'AWAITING_NPS_SCORE',
  nps_score INT NULL,
  nps_profile VARCHAR(30) NULL,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  demo_scenario VARCHAR(80) NULL,
  last_message_sid VARCHAR(180) NULL,
  last_inbound_at DATETIME NULL,
  last_outbound_at DATETIME NULL,
  metadata_json LONGTEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_nps_twilio_conversation_id (conversation_id),
  INDEX idx_nps_twilio_conversation_invite (nps_invite_id),
  INDEX idx_nps_twilio_conversation_phone (patient_phone_normalized, updated_at),
  INDEX idx_nps_twilio_conversation_state (state, updated_at)
);

CREATE TABLE IF NOT EXISTS nps_twilio_conversation_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  conversation_id BIGINT NULL,
  nps_invite_id BIGINT NULL,
  nps_response_id INT NULL,
  message_sid VARCHAR(180) NULL,
  direction VARCHAR(20) NOT NULL DEFAULT 'inbound',
  provider VARCHAR(40) NOT NULL DEFAULT 'TWILIO',
  state_before VARCHAR(80) NULL,
  state_after VARCHAR(80) NULL,
  message_type VARCHAR(80) NULL,
  source_type VARCHAR(40) NULL,
  body LONGTEXT NULL,
  transcription_text LONGTEXT NULL,
  transcription_status VARCHAR(40) NULL,
  metadata_json LONGTEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_nps_twilio_event_message_sid (message_sid),
  INDEX idx_nps_twilio_event_conversation (conversation_id, created_at),
  INDEX idx_nps_twilio_event_response (nps_response_id, created_at)
);

CREATE TABLE IF NOT EXISTS nps_audio_transcriptions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  conversation_id BIGINT NULL,
  nps_response_id INT NULL,
  message_sid VARCHAR(180) NULL,
  media_url TEXT NULL,
  mime_type VARCHAR(120) NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'PENDING',
  model VARCHAR(80) NULL,
  transcript LONGTEXT NULL,
  correction_text LONGTEXT NULL,
  error_message TEXT NULL,
  confirmed_at DATETIME NULL,
  correction_requested_at DATETIME NULL,
  metadata_json LONGTEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_nps_audio_conversation (conversation_id, created_at),
  INDEX idx_nps_audio_response (nps_response_id, created_at),
  INDEX idx_nps_audio_status (status, created_at)
);

CREATE TABLE IF NOT EXISTS nps_referral_dental_card_links (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  nps_referral_id BIGINT NOT NULL,
  dental_card_lead_id INT NOT NULL,
  nps_response_id INT NULL,
  nps_invite_id BIGINT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_nps_referral_dental_link (nps_referral_id),
  INDEX idx_nps_referral_dental_lead (dental_card_lead_id),
  INDEX idx_nps_referral_dental_invite (nps_invite_id)
);

ALTER TABLE nps_whatsapp_inbound_events ADD COLUMN IF NOT EXISTS nps_conversation_id BIGINT NULL;
ALTER TABLE nps_whatsapp_inbound_events ADD COLUMN IF NOT EXISTS source_type VARCHAR(40) NULL;

ALTER TABLE nps_responses ADD COLUMN IF NOT EXISTS conversation_state VARCHAR(80) NULL;
ALTER TABLE nps_responses ADD COLUMN IF NOT EXISTS source_type VARCHAR(40) NULL DEFAULT 'TEXT';
ALTER TABLE nps_responses ADD COLUMN IF NOT EXISTS audio_transcription_status VARCHAR(40) NULL;
ALTER TABLE nps_responses ADD COLUMN IF NOT EXISTS audio_transcription_text LONGTEXT NULL;
ALTER TABLE nps_responses ADD COLUMN IF NOT EXISTS audio_transcription_confirmed_at DATETIME NULL;
ALTER TABLE nps_responses ADD COLUMN IF NOT EXISTS twilio_message_sid VARCHAR(180) NULL;

ALTER TABLE nps_referrals ADD COLUMN IF NOT EXISTS source VARCHAR(80) NULL DEFAULT 'NPS_WHATSAPP_REFERRAL';
ALTER TABLE nps_referrals ADD COLUMN IF NOT EXISTS provider VARCHAR(40) NULL DEFAULT 'TWILIO';
ALTER TABLE nps_referrals ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(120) NULL;
ALTER TABLE nps_referrals ADD COLUMN IF NOT EXISTS dental_card_lead_id INT NULL;
