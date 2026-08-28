CREATE INDEX CONCURRENTLY idx_password_reset_tokens_user ON password_reset_tokens(user_id, created_at DESC);
