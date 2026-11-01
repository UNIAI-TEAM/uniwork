CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_drive_folders_ws_folder_uidx
  ON drive_folders (workspace_id, drive_folder_id);
