ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS ip;
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS user_agent;
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS session_id;
ALTER TABLE users DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE users DROP COLUMN IF EXISTS mfa_recovery_codes;
ALTER TABLE users DROP COLUMN IF EXISTS mfa_enabled_at;
ALTER TABLE users DROP COLUMN IF EXISTS totp_secret;
