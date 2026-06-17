ALTER TABLE users
  ADD COLUMN IF NOT EXISTS crc_clinic_selection_completed_at TIMESTAMP NULL AFTER authorization_status;
