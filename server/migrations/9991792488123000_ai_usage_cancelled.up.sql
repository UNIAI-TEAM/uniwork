ALTER TABLE ai_usage_events DROP CONSTRAINT IF EXISTS ai_usage_events_status_check;
ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_events_status_check
  CHECK (status IN ('pending', 'succeeded', 'failed', 'rejected', 'cancelled'));
