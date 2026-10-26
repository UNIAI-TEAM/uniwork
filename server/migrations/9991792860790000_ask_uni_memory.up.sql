-- Ask UNI memory (P4, UNI-2156): one short list per person per organization,
-- and the "remember this?" proposals a chat turn leaves behind. No foreign
-- keys by repo rule; the 50-entry cap is held by the service under a lock.
CREATE TABLE IF NOT EXISTS ai_memories (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('preference', 'fact')),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 300),
  source TEXT NOT NULL CHECK (source IN ('manual', 'chat', 'import')),
  proposal_id TEXT,
  created_by TEXT NOT NULL,
  created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('human', 'agent', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_memory_proposals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('remember', 'update', 'forget')),
  memory_id TEXT,
  kind TEXT,
  body TEXT CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 300),
  before_kind TEXT,
  before_body TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'rejected', 'undone')),
  expires_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('human', 'agent', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ask_uni_memory_off BOOLEAN NOT NULL DEFAULT false;

-- JSON array of the memory entry ids an answer followed (ids only, never text).
ALTER TABLE ai_messages
  ADD COLUMN IF NOT EXISTS memory_ids TEXT NOT NULL DEFAULT '[]';
