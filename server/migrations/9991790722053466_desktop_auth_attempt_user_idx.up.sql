CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_desktop_auth_attempts_user ON desktop_auth_attempts(user_id, created_at DESC) WHERE user_id IS NOT NULL;
