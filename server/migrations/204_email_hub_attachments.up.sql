-- Attachment metadata for cached threads. Bytes are fetched from IMAP on demand.
CREATE TABLE email_hub_attachments (
  id              TEXT PRIMARY KEY,
  thread_id       TEXT NOT NULL,
  account_id      TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  filename        TEXT NOT NULL DEFAULT '',
  mime_type       TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes      BIGINT NOT NULL DEFAULT 0,
  part_id         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
