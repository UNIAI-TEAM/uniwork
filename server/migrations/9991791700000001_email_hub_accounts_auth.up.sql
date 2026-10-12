-- UNI-1237: per-mailbox auth kind, TLS mode and login name, OAuth tokens
-- (sealed like password_enc), the needs-reconnect state, and the version
-- that fences writes made from an older credential snapshot.
ALTER TABLE email_hub_accounts
  ADD COLUMN IF NOT EXISTS auth_kind TEXT NOT NULL DEFAULT 'password',
  ADD COLUMN IF NOT EXISTS imap_security TEXT NOT NULL DEFAULT 'tls',
  ADD COLUMN IF NOT EXISTS smtp_security TEXT NOT NULL DEFAULT 'starttls',
  ADD COLUMN IF NOT EXISTS username TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS oauth_refresh_token_enc TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS oauth_access_token_enc TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS oauth_access_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auth_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auth_failed_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS credential_version BIGINT NOT NULL DEFAULT 0;
