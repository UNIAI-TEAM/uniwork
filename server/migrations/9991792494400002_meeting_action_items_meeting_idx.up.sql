CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_action_items_meeting
  ON meeting_action_items (meeting_id, position);
