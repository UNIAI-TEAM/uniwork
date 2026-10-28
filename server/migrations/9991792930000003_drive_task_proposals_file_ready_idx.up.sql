CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drive_task_proposals_file_ready_idx
  ON drive_task_proposals (drive_file_id)
  WHERE status = 'ready';
