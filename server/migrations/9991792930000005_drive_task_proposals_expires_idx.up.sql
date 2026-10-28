CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drive_task_proposals_expires_idx
  ON drive_task_proposals (expires_at);
