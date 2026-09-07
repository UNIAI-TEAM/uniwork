CREATE TABLE chat_user_nicknames (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  owner_user_id   TEXT NOT NULL,
  target_user_id  TEXT NOT NULL,
  nickname        TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
