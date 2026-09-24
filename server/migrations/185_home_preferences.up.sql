-- Personal Home layout (sections on/off, their order, density) for one person
-- in one workspace. No foreign keys (ADR 0001): a row for a person who left
-- the workspace is inert, because every read goes through the membership gate.
-- Not audited: it is a display setting, like task_view_preferences.
CREATE TABLE IF NOT EXISTS home_preferences (
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  prefs           JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(prefs) = 'object'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
