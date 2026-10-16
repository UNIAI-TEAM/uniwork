-- Old slugs and task prefixes a workspace still answers to (spec 2026-10-14
-- §4.2): an old slug redirects to the current one, and an old task prefix
-- still resolves PREFIX-N. No FK (ADR 0001): the service writes and deletes
-- rows in the same transaction as the workspace change. No created_by: who
-- made the change is in audit_events.
CREATE TABLE workspace_aliases (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  kind            TEXT NOT NULL,
  value           TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT workspace_aliases_kind_check CHECK (kind IN ('slug', 'task_prefix'))
);
