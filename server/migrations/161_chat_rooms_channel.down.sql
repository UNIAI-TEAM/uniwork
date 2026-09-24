ALTER TABLE chat_rooms DROP CONSTRAINT IF EXISTS chat_rooms_visibility_check;
ALTER TABLE chat_rooms
  DROP COLUMN IF EXISTS archived_by,
  DROP COLUMN IF EXISTS archived_at,
  DROP COLUMN IF EXISTS created_by_kind,
  DROP COLUMN IF EXISTS is_default,
  DROP COLUMN IF EXISTS topic,
  DROP COLUMN IF EXISTS project_id,
  DROP COLUMN IF EXISTS visibility;
ALTER TABLE chat_rooms DROP CONSTRAINT IF EXISTS chat_rooms_kind_check;
ALTER TABLE chat_rooms ADD CONSTRAINT chat_rooms_kind_check
  CHECK (kind IN ('workspace', 'group', 'dm'));
