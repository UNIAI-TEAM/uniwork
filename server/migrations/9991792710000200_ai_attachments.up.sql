-- The files an Ask UNI question carried (UNI-2119). One row per file, pointing
-- at the user's ai_messages row; the bytes live in FileService. No foreign
-- keys: the service deletes a conversation's rows with its messages and then
-- releases the files.
CREATE TABLE IF NOT EXISTS ai_attachments (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id      TEXT NOT NULL,
  file_id         TEXT NOT NULL,
  name            TEXT NOT NULL,
  mime            TEXT NOT NULL,
  size_bytes      BIGINT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('image', 'pdf', 'text')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
