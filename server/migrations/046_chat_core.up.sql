-- Native chat (Phase 1: workspace channel). No FKs (post-004 rule).
-- Indexes live in later single-statement files.

CREATE TABLE chat_rooms (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL CHECK (kind IN ('workspace', 'group', 'dm')),
  workspace_id      TEXT,
  name              TEXT NOT NULL DEFAULT '',
  member_set_key    TEXT,
  livekit_room_name TEXT NOT NULL,
  created_by        TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_room_members (
  id            TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL,
  workspace_id  TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'left')),
  invited_by    TEXT,
  joined_at     TIMESTAMPTZ,
  left_at       TIMESTAMPTZ,
  last_read_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
  id                   TEXT PRIMARY KEY,
  room_id              TEXT NOT NULL,
  workspace_id         TEXT NOT NULL,
  sender_id            TEXT NOT NULL,
  kind                 TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'system', 'voice_call_log')),
  body                 TEXT NOT NULL DEFAULT '',
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  reply_to_message_id  TEXT,
  edited_at            TIMESTAMPTZ,
  deleted_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
