CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_device_sessions_user ON device_sessions(user_id, created_at DESC);
