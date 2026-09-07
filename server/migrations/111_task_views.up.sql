CREATE TABLE IF NOT EXISTS task_views (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('workspace','my','project')),
  scope_id TEXT,
  scope_variant TEXT CHECK (scope_variant IN ('assigned','created','involved','any')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','workspace')),
  definition_version INTEGER NOT NULL DEFAULT 1,
  query JSONB NOT NULL CHECK (jsonb_typeof(query) = 'object'),
  display JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(display) = 'object'),
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (scope_type = 'project' AND scope_id IS NOT NULL)
    OR (scope_type IN ('workspace','my') AND scope_id IS NULL)
  ),
  CHECK (
    (scope_type = 'my' AND scope_variant IS NOT NULL)
    OR (scope_type <> 'my' AND scope_variant IS NULL)
  ),
  CHECK (scope_type <> 'my' OR visibility = 'private')
);

CREATE TABLE IF NOT EXISTS task_view_preferences (
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('workspace','my','project')),
  scope_id TEXT NOT NULL,
  prefs JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(prefs) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, scope_type, scope_id)
);
