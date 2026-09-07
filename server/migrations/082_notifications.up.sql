-- Per-user notification records (spec F-07 §3.1). No FK: a notification
-- outlives the task or meeting it points at (the inbox shows "đã xóa") and
-- history is kept for digests already sent. Titles are not rendered here:
-- title_key + params are rendered by the client in its current locale.
CREATE TABLE IF NOT EXISTS notifications (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT,
  kind            TEXT NOT NULL,
  group_key       TEXT NOT NULL,
  resource_type   TEXT NOT NULL,
  resource_id     TEXT NOT NULL,
  actor_kind      TEXT NOT NULL CHECK (actor_kind IN ('human', 'agent', 'system')),
  actor_id        TEXT NOT NULL,
  title_key       TEXT NOT NULL,
  params          TEXT NOT NULL DEFAULT '{}',
  count           INTEGER NOT NULL DEFAULT 1,
  correlation_id  TEXT,
  read_at         TIMESTAMPTZ,
  archived_at     TIMESTAMPTZ,
  pushed_at       TIMESTAMPTZ,
  digested_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
