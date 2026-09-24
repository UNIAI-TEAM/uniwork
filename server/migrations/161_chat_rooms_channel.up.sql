ALTER TABLE chat_rooms DROP CONSTRAINT chat_rooms_kind_check;
ALTER TABLE chat_rooms ADD CONSTRAINT chat_rooms_kind_check
  CHECK (kind IN ('workspace', 'group', 'dm', 'channel'));
ALTER TABLE chat_rooms
  ADD COLUMN visibility      TEXT NOT NULL DEFAULT 'private',
  ADD COLUMN project_id      TEXT,
  ADD COLUMN topic           TEXT NOT NULL DEFAULT '',
  ADD COLUMN is_default      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN created_by_kind TEXT NOT NULL DEFAULT 'human',
  ADD COLUMN archived_at     TIMESTAMPTZ,
  ADD COLUMN archived_by     TEXT;
ALTER TABLE chat_rooms ADD CONSTRAINT chat_rooms_visibility_check
  CHECK (visibility IN ('public', 'private'));
