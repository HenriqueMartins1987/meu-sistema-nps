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
  referral_status VARCHAR(40) NOT NULL DEFAULT 'received',
  referral_accepted_at DATETIME NULL,
  referral_received_at DATETIME NULL,
  converted_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_nps_referrals_response (nps_response_id),
  INDEX idx_nps_referrals_invite (nps_invite_id),
  INDEX idx_nps_referrals_clinic (clinic_id, created_at),
  INDEX idx_nps_referrals_phone (referral_phone, created_at),
  INDEX idx_nps_referrals_status (referral_status, created_at),
  UNIQUE KEY uniq_nps_referral_response_phone (nps_response_id, referral_phone)
);

ALTER TABLE nps_responses
  ADD COLUMN IF NOT EXISTS clinic_name VARCHAR(180) NULL,
  ADD COLUMN IF NOT EXISTS response_channel VARCHAR(40) NOT NULL DEFAULT 'link',
  ADD COLUMN IF NOT EXISTS responded_at DATETIME NULL;
