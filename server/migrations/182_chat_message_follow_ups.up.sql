CREATE TABLE chat_message_follow_ups (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  room_id           TEXT NOT NULL,
  message_id        TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  note              TEXT NOT NULL DEFAULT '',
  due_at            TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_by        TEXT NOT NULL,
  created_by_kind   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_message_follow_ups_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system'))
);
