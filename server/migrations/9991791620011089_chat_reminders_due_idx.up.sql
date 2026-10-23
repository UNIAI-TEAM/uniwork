CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_reminders_due
  ON chat_reminders (next_fire_at)
  WHERE next_fire_at IS NOT NULL;
