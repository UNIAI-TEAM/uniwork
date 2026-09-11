CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emails_user_kind ON emails(user_id, kind) WHERE user_id IS NOT NULL;
