-- Per-user IMAP mailboxes (App Password). No FK: account outlives membership
-- rows; cleanup in service. password_enc is AES-GCM via secretbox.
CREATE TABLE email_hub_accounts (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  email_address   TEXT NOT NULL,
  provider        TEXT NOT NULL DEFAULT 'gmail',
  imap_host       TEXT NOT NULL,
  imap_port       INTEGER NOT NULL DEFAULT 993,
  smtp_host       TEXT NOT NULL,
  smtp_port       INTEGER NOT NULL DEFAULT 587,
  password_enc    TEXT NOT NULL,
  sync_state      JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at TIMESTAMPTZ
);
