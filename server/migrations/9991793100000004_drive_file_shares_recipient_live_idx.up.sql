CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drive_file_shares_recipient_live_idx
  ON drive_file_shares (organization_id, workspace_id, principal_type, principal_id, created_at DESC, drive_file_id)
  WHERE revoked_at IS NULL;
