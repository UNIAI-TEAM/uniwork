CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_drive_task_proposal_links_proposal_item_uidx
  ON drive_task_proposal_links (proposal_id, item_index);
