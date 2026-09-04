CREATE INDEX CONCURRENTLY idx_webhook_inbox_pending
  ON webhook_inbox (status, next_attempt_at)
  WHERE status = 'PENDING';
