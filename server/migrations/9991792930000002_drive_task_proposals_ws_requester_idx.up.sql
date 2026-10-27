CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drive_task_proposals_ws_requester_idx
  ON drive_task_proposals (workspace_id, requested_by, created_at);
