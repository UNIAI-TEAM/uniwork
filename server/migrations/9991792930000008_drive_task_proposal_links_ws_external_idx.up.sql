CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drive_task_proposal_links_ws_external_idx
  ON drive_task_proposal_links (workspace_id, external_file_id, created_at);
