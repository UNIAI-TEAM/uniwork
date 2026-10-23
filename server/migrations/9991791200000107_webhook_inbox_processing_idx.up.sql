-- G12 (UNI-936): ReleaseStaleWebhookInbox runs every tick on
-- status = 'PROCESSING' AND next_attempt_at < now(); index 034 covers PENDING
-- only. The webhook lag gauge reads min(received_at) of this set too.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_inbox_processing ON webhook_inbox (next_attempt_at) WHERE status = 'PROCESSING';
