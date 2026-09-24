CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_rooms_project ON chat_rooms (project_id)
  WHERE project_id IS NOT NULL;
