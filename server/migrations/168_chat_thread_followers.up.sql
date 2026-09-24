CREATE TABLE chat_thread_followers (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  room_id         TEXT NOT NULL,
  thread_root_id  TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  reason          TEXT NOT NULL,
  muted           BOOLEAN NOT NULL DEFAULT false,
  last_read_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_thread_followers_reason_check
    CHECK (reason IN ('author', 'replied', 'mentioned', 'manual'))
);
