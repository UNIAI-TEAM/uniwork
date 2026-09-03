CREATE TABLE chat_blocks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
