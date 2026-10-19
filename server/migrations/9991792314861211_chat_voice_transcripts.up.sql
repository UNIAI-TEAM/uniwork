-- On-demand transcripts of chat voice messages (UNI-1908 F2): one row per
-- message, written the first time a reader asks and served free afterwards.
-- No foreign key (migration lint): ChatService resolves the message and its
-- room before it reads or writes a row.
CREATE TABLE chat_voice_transcripts (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  message_id      TEXT NOT NULL,
  text            TEXT NOT NULL,
  language        TEXT NOT NULL DEFAULT '',
  created_by      TEXT NOT NULL,
  created_by_kind TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_voice_transcripts_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system'))
);
