CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_drive_file_access_file_user_uidx
  ON drive_file_access (drive_file_id, user_id);
