-- Cached mailbox threads (metadata + optional body). No FK: threads stay until
-- account disconnect cleanup. Body is lazy-loaded when the user opens a row.
CREATE TABLE email_hub_threads (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  folder          TEXT NOT NULL DEFAULT 'INBOX',
  imap_uid        INTEGER NOT NULL,
  message_id      TEXT,
  subject         TEXT NOT NULL DEFAULT '',
  snippet         TEXT NOT NULL DEFAULT '',
  from_addr       TEXT NOT NULL DEFAULT '',
  from_name       TEXT,
  to_addrs        TEXT[] NOT NULL DEFAULT '{}',
  sent_at         TIMESTAMPTZ NOT NULL,
  is_read         BOOLEAN NOT NULL DEFAULT false,
  is_starred      BOOLEAN NOT NULL DEFAULT false,
  has_attachments BOOLEAN NOT NULL DEFAULT false,
  body_text       TEXT,
  body_html       TEXT,
  body_cached     BOOLEAN NOT NULL DEFAULT false,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
