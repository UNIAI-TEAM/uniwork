CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_summary_task_links_summary
  ON meeting_summary_task_links (summary_id);
