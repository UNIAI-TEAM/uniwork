CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_rooms_ws_kind_visibility
  ON chat_rooms (workspace_id, kind, visibility) WHERE archived_at IS NULL;
