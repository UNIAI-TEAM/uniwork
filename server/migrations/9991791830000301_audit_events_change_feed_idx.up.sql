-- G5-01b: the incremental feed's keyset read. One probe of this partial index
-- walks (workspace_id, xact_id, id) in commit order for one workspace's
-- document audit rows; the dispatcher never updates these rows, so the index
-- needs no maintenance beyond the append. CONCURRENTLY and alone in its file
-- (migration lint: PostgreSQL rejects a concurrent build inside a transaction).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_events_change_feed
  ON audit_events (workspace_id, xact_id, id)
  WHERE xact_id IS NOT NULL AND resource_type = 'document';
