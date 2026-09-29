-- Assignee frequency (ListAssigneeFrequency) reads one caller's audit rows in
-- one workspace over a bounded window; without this it scans the organization.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_events_ws_actor
  ON audit_events (workspace_id, actor_id, occurred_at DESC);
