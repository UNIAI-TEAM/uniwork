CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drive_file_shares_file_live_idx
  ON drive_file_shares (organization_id, workspace_id, drive_file_id, created_at ASC, id ASC)
  WHERE revoked_at IS NULL;
