CREATE TABLE chat_thread_task_links (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  room_id         TEXT NOT NULL,
  thread_root_id  TEXT NOT NULL,
  task_id         TEXT NOT NULL,
  direction       TEXT NOT NULL DEFAULT 'both',
  created_by      TEXT NOT NULL,
  created_by_kind TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_thread_task_links_direction_check CHECK (direction IN ('both', 'chat_to_task'))
);
