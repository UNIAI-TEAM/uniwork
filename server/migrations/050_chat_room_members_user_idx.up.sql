CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_room_members_user_ws
  ON chat_room_members (user_id, workspace_id, updated_at DESC);
