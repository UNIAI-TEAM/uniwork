CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drive_files_ws_folder_active_idx
  ON drive_files (workspace_id, drive_folder_id)
  WHERE unlinked_at IS NULL AND drive_folder_id IS NOT NULL;
