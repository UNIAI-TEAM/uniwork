CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drive_folders_ws_parent_idx
  ON drive_folders (workspace_id, parent_folder_id)
  WHERE parent_folder_id IS NOT NULL;
