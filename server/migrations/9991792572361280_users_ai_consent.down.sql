ALTER TABLE users
  DROP COLUMN IF EXISTS ai_consent_at,
  DROP COLUMN IF EXISTS ai_consent_version;
