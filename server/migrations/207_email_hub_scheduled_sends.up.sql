-- Outbound mail queued for later delivery via SMTP.
CREATE TABLE email_hub_scheduled_sends (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  account_id      TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  payload         JSONB NOT NULL,
  send_at         TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ
);
