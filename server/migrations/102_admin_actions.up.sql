-- F-11: every platform-admin operation, with the mandatory reason, beside
-- its audit_events row (same transaction). Platform-level: the target may be
-- an organization, a user or a flag, so the table sits above tenants and is
-- exempted in lint_test.go.
CREATE TABLE IF NOT EXISTS admin_actions (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT NOT NULL,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  before      JSONB NOT NULL DEFAULT '{}'::jsonb,
  after       JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason      TEXT NOT NULL,
  trace_id    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
