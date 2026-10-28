-- The handoff package Ask UNI leaves for the editor AI after it creates an
-- Office file (UNI-2264): the approved request, the outline split into parts
-- and the quoted sources, bound to the asker and the new document. Rows expire
-- after 24 hours. No foreign keys: the expiry sweeper deletes the rows.
CREATE TABLE IF NOT EXISTS ai_office_handoffs (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  document_id     TEXT NOT NULL,
  proposal_id     TEXT NOT NULL,
  format          TEXT NOT NULL,
  title           TEXT NOT NULL,
  request         TEXT NOT NULL,
  outline         TEXT NOT NULL,
  parts           JSONB NOT NULL,
  sources         JSONB NOT NULL,
  next_part       INT NOT NULL DEFAULT 0,
  conversation_id TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
