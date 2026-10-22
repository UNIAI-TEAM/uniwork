-- One thumbs up/down per person per Ask UNI answer (UNI-2015 R14). No foreign
-- keys: the service deletes a conversation's rows together with its messages.
CREATE TABLE IF NOT EXISTS ai_message_feedback (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id      TEXT NOT NULL,
  rating          TEXT NOT NULL CHECK (rating IN ('up', 'down')),
  reason          TEXT NOT NULL DEFAULT '' CHECK (reason IN ('', 'wrong_facts', 'missing_sources', 'not_helpful', 'other')),
  note            TEXT NOT NULL DEFAULT '',
  created_by      TEXT NOT NULL,
  created_by_kind TEXT NOT NULL DEFAULT 'human',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
