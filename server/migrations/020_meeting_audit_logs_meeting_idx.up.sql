CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_audit_logs_meeting ON meeting_audit_logs (meeting_id, occurred_at DESC);
