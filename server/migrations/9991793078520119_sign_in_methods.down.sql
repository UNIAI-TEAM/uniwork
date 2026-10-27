DROP TABLE IF EXISTS sign_in_email_claims;
ALTER TABLE email_verification_codes
  DROP COLUMN IF EXISTS action,
  DROP COLUMN IF EXISTS purpose;
ALTER TABLE users
  DROP COLUMN IF EXISTS second_factor_locked_until,
  DROP COLUMN IF EXISTS second_factor_failures,
  DROP COLUMN IF EXISTS credentials_revoked_at,
  DROP COLUMN IF EXISTS password_changed_at,
  DROP COLUMN IF EXISTS apple_unlinked_sub,
  DROP COLUMN IF EXISTS apple_linked_at,
  DROP COLUMN IF EXISTS apple_email,
  DROP COLUMN IF EXISTS google_unlinked_sub,
  DROP COLUMN IF EXISTS google_linked_at,
  DROP COLUMN IF EXISTS google_email;
