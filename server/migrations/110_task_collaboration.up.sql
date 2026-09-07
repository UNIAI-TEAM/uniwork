ALTER TABLE task_comments
  ADD COLUMN IF NOT EXISTS organization_id TEXT,
  ADD COLUMN IF NOT EXISTS workspace_id TEXT,
  ADD COLUMN IF NOT EXISTS parent_comment_id TEXT,
  ADD COLUMN IF NOT EXISTS comment_type TEXT NOT NULL DEFAULT 'comment',
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by_type TEXT,
  ADD COLUMN IF NOT EXISTS resolved_by_id TEXT,
  ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE task_comments c
SET organization_id = t.organization_id,
    workspace_id = t.workspace_id,
    updated_at = c.created_at
FROM tasks t
WHERE t.id = c.task_id;

ALTER TABLE task_comments
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE task_comments
  ADD CONSTRAINT task_comments_comment_type_check CHECK (comment_type IN ('comment','status_change','progress_update','system')),
  ADD CONSTRAINT task_comments_resolved_by_type_check CHECK (resolved_by_type IS NULL OR resolved_by_type IN ('member','agent','system')),
  ADD CONSTRAINT task_comments_resolved_consistency_check CHECK (
    (resolved_at IS NULL AND resolved_by_type IS NULL AND resolved_by_id IS NULL)
    OR (resolved_at IS NOT NULL AND resolved_by_type IS NOT NULL AND resolved_by_id IS NOT NULL)
  );

CREATE TABLE IF NOT EXISTS comment_reactions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('member','agent')),
  actor_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (comment_id, actor_type, actor_id, emoji)
);

CREATE TABLE IF NOT EXISTS task_reactions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('member','agent')),
  actor_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, actor_type, actor_id, emoji)
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  task_id TEXT,
  comment_id TEXT,
  uploader_type TEXT NOT NULL CHECK (uploader_type IN ('member','agent')),
  uploader_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  object_url TEXT,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  source_context_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (task_id IS NOT NULL OR comment_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS task_source_contexts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  task_id TEXT,
  origin_task_id TEXT,
  source_task_id TEXT NOT NULL,
  anchor_comment_id TEXT NOT NULL,
  captured_by_user_id TEXT NOT NULL,
  snapshot_version SMALLINT NOT NULL,
  snapshot JSONB NOT NULL,
  capture_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','attached','abandoned')),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attached_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (state = 'pending' AND task_id IS NULL AND origin_task_id IS NOT NULL AND attached_at IS NULL)
    OR (state = 'attached' AND task_id IS NOT NULL AND attached_at IS NOT NULL)
    OR (state = 'abandoned' AND task_id IS NULL AND attached_at IS NULL)
  )
);
