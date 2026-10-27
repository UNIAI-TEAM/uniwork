CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drive_file_access_ws_user_idx
  ON drive_file_access (workspace_id, user_id, connection_id);
