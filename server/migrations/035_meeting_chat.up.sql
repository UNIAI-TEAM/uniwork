-- Persisted in-room chat. No FKs (post-004 rule).
-- Index lives in a later single-statement CONCURRENTLY file.

CREATE TABLE IF NOT EXISTS meeting_chat_messages (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  participant_id TEXT,
  sender_identity TEXT NOT NULL,
  sender_name TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
