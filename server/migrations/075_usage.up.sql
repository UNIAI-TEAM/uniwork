-- usage_events is append-only and the source to recompute counters from;
-- usage_counters is the per-period total written in the same transaction.
-- Snapshot meters (members.max, workspaces.max) count their source table
-- instead and never touch these.
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT,
  meter_key TEXT NOT NULL,
  delta BIGINT NOT NULL,
  actor_id TEXT,
  actor_kind TEXT NOT NULL DEFAULT 'human' CHECK (actor_kind IN ('human', 'agent', 'system')),
  ref_type TEXT,
  ref_id TEXT,
  idempotency_key TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_counters (
  organization_id TEXT NOT NULL,
  meter_key TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  total BIGINT NOT NULL DEFAULT 0,
  notified_80_at TIMESTAMPTZ,
  notified_100_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, meter_key, period_start)
);
