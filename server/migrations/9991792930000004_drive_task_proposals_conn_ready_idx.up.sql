CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drive_task_proposals_conn_ready_idx
  ON drive_task_proposals (connection_id)
  WHERE status = 'ready';
