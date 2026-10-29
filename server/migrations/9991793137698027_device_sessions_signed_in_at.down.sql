ALTER TABLE desktop_auth_attempts DROP COLUMN IF EXISTS approver_signed_in_at;
ALTER TABLE device_sessions DROP COLUMN IF EXISTS signed_in_at;
