-- F-03: departments are the organization's own structure, not a workspace's,
-- and a shallow tree on purpose — two levels cover a 1,000-person company and
-- keep the picker readable (OPEN_QUESTIONS P4). parent_id is here so a third
-- level is a rule change rather than a migration.
CREATE TABLE IF NOT EXISTS departments (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  parent_id       TEXT,
  name            TEXT NOT NULL,
  code            TEXT,
  head_user_id    TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  archived_at     TIMESTAMPTZ,
  created_by      TEXT NOT NULL,
  created_by_kind TEXT NOT NULL DEFAULT 'human',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
