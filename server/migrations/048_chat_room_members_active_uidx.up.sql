CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_chat_room_members_active
  ON chat_room_members (room_id, user_id) WHERE status IN ('invited', 'active');
