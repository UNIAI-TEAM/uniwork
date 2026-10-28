CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_drive_file_shares_live_uidx
  ON drive_file_shares (drive_file_id, principal_type, principal_id)
  WHERE revoked_at IS NULL;
