CREATE TABLE chat_message_links (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  room_id         TEXT NOT NULL,
  message_id      TEXT NOT NULL,
  target_type     TEXT NOT NULL,
  target_id       TEXT NOT NULL,
  relation        TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  created_by_kind TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_message_links_target_check CHECK (target_type IN ('task')),
  CONSTRAINT chat_message_links_relation_check CHECK (relation IN ('created_from', 'mentions'))
);
