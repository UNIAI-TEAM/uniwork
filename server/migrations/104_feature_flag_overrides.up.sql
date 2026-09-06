-- F-11 §7: per-organization / per-user / global flag overrides read by the
-- DB provider ahead of the static file. scope_id is '' for global so the
-- unique index holds. expires_at is mandatory for user scope (service rule).
-- Platform-level table (exempted in lint_test.go): one row may target any org.
CREATE TABLE IF NOT EXISTS feature_flag_overrides (
  id              TEXT PRIMARY KEY,
  flag_key        TEXT NOT NULL,
  scope_type      TEXT NOT NULL CHECK (scope_type IN ('organization', 'user', 'global')),
  scope_id        TEXT NOT NULL DEFAULT '',
  enabled         BOOLEAN NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  created_by      TEXT NOT NULL,
  created_by_kind TEXT NOT NULL DEFAULT 'human' CHECK (created_by_kind IN ('human', 'agent', 'system')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ
);
