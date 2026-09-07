CREATE TABLE IF NOT EXISTS task_statuses (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  key TEXT NOT NULL CHECK (key ~ '^[a-z0-9][a-z0-9_]{0,31}$'),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 256),
  category TEXT NOT NULL CHECK (category IN ('backlog','todo','in_progress','in_review','done','blocked','cancelled')),
  color TEXT NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
  is_system BOOLEAN NOT NULL DEFAULT false,
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_by_kind TEXT NOT NULL DEFAULT 'human' CHECK (created_by_kind IN ('human','agent','system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT is_system OR key = category),
  CHECK (NOT is_system OR archived_at IS NULL)
);

CREATE TABLE IF NOT EXISTS task_labels (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  color TEXT NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 256),
  archived_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_by_kind TEXT NOT NULL DEFAULT 'human' CHECK (created_by_kind IN ('human','agent','system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_properties (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  type TEXT NOT NULL CHECK (type IN ('text','number','select','multi_select','date','checkbox','url')),
  description TEXT NOT NULL DEFAULT '',
  config JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_by_kind TEXT NOT NULL DEFAULT 'human' CHECK (created_by_kind IN ('human','agent','system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
