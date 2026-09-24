-- Cached AI summaries for Email Hub threads (per locale). Invalidated when body/metadata changes.
CREATE TABLE email_hub_thread_ai_summaries (
  id                  TEXT PRIMARY KEY,
  organization_id     TEXT NOT NULL,
  thread_id           TEXT NOT NULL,
  account_id          TEXT NOT NULL,
  locale              TEXT NOT NULL,
  source_fingerprint  TEXT NOT NULL,
  summary             TEXT NOT NULL,
  key_points          JSONB NOT NULL DEFAULT '[]',
  action_items        JSONB NOT NULL DEFAULT '[]',
  needs_reply         BOOLEAN NOT NULL DEFAULT false,
  reply_hint          TEXT NOT NULL DEFAULT '',
  model               TEXT NOT NULL DEFAULT '',
  created_by          TEXT NOT NULL,
  created_by_kind     TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
