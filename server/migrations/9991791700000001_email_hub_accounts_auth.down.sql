ALTER TABLE email_hub_accounts
  DROP COLUMN IF EXISTS credential_version,
  DROP COLUMN IF EXISTS auth_failed_reason,
  DROP COLUMN IF EXISTS auth_failed_at,
  DROP COLUMN IF EXISTS oauth_access_expires_at,
  DROP COLUMN IF EXISTS oauth_access_token_enc,
  DROP COLUMN IF EXISTS oauth_refresh_token_enc,
  DROP COLUMN IF EXISTS username,
  DROP COLUMN IF EXISTS smtp_security,
  DROP COLUMN IF EXISTS imap_security,
  DROP COLUMN IF EXISTS auth_kind;
