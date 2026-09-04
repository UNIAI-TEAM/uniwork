CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_chat_rooms_member_set
  ON chat_rooms (workspace_id, kind, member_set_key)
  WHERE kind IN ('group', 'dm') AND member_set_key IS NOT NULL;
