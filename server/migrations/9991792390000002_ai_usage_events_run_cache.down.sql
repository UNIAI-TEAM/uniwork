ALTER TABLE ai_usage_events
  DROP COLUMN IF EXISTS run_id,
  DROP COLUMN IF EXISTS cache_read_tokens,
  DROP COLUMN IF EXISTS cache_write_tokens;
