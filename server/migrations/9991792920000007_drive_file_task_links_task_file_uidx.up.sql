CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_drive_file_task_links_task_file_uidx
  ON drive_file_task_links (task_id, drive_file_id);
