-- Task → its action item: the carried-over items of đợt 4 and its catch-up copy.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_action_items_task
  ON meeting_action_items (task_id) WHERE task_id IS NOT NULL;
