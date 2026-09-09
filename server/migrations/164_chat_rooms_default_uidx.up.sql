CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_chat_rooms_default_per_workspace
  ON chat_rooms (workspace_id) WHERE is_default;
