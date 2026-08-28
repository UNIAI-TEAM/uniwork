CREATE INDEX CONCURRENTLY idx_emails_pending ON emails(next_attempt_at) WHERE sent_at IS NULL AND failed_at IS NULL;
