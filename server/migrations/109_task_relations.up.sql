CREATE TABLE IF NOT EXISTS task_label_links (
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  label_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, task_id, label_id)
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('blocks','blocked_by','related')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, task_id, depends_on_task_id, type),
  CHECK (task_id <> depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS task_subscribers (
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('member','agent')),
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('creator','assignee','commenter','mentioned','manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, task_id, actor_type, actor_id)
);

CREATE TABLE IF NOT EXISTS task_pins (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('task','project','task_view')),
  item_id TEXT NOT NULL,
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id, item_type, item_id)
);
