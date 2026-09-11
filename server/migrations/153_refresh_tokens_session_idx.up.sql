CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refresh_tokens_session ON refresh_tokens(session_id);
