CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drive_file_task_links_file_idx
  ON drive_file_task_links (workspace_id, drive_file_id, created_at);
