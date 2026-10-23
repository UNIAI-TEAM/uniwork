ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS task_prefix TEXT NOT NULL DEFAULT 'TASK',
  ADD COLUMN IF NOT EXISTS task_counter BIGINT NOT NULL DEFAULT 0;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_priority_check;

-- One ADD COLUMN per statement: a multi-column ALTER checks the 1600 slot
-- limit against every new column at once; after many test rollbacks, slots
-- from dropped columns can block the batch even when few columns are live.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS number BIGINT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_type TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS creator_type TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS creator_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS acceptance_criteria JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS context_refs JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS properties JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS stage INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS origin_type TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS origin_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS first_executed_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS revision BIGINT DEFAULT 1;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

UPDATE tasks t
SET organization_id = w.organization_id,
    creator_id = t.created_by,
    creator_type = CASE t.created_by_kind WHEN 'human' THEN 'member' ELSE t.created_by_kind END,
    assignee_type = CASE WHEN t.assignee_id IS NULL THEN NULL WHEN t.assignee_kind = 'human' THEN 'member' ELSE t.assignee_kind END,
    last_activity_at = t.updated_at
FROM workspaces w
WHERE w.id = t.workspace_id;

WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY workspace_id ORDER BY created_at, id) AS n
  FROM tasks
)
UPDATE tasks t SET number = numbered.n FROM numbered WHERE numbered.id = t.id;

UPDATE workspaces w
SET task_prefix = COALESCE(NULLIF(upper(left(regexp_replace(w.slug, '[^a-zA-Z0-9]', '', 'g'), 3)), ''), 'UW'),
    task_counter = COALESCE((SELECT max(t.number) FROM tasks t WHERE t.workspace_id = w.id), 0);

ALTER TABLE tasks
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN number SET NOT NULL,
  ALTER COLUMN creator_id SET NOT NULL,
  ALTER COLUMN creator_type SET NOT NULL,
  ALTER COLUMN revision SET NOT NULL,
  ALTER COLUMN last_activity_at SET NOT NULL;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_priority_check CHECK (priority IN ('urgent','high','medium','low','none')),
  ADD CONSTRAINT tasks_assignee_type_check CHECK (assignee_type IS NULL OR assignee_type IN ('member','agent','squad')),
  ADD CONSTRAINT tasks_creator_type_check CHECK (creator_type IN ('member','agent','system')),
  ADD CONSTRAINT tasks_acceptance_criteria_check CHECK (jsonb_typeof(acceptance_criteria) = 'array'),
  ADD CONSTRAINT tasks_context_refs_check CHECK (jsonb_typeof(context_refs) = 'array'),
  ADD CONSTRAINT tasks_metadata_check CHECK (jsonb_typeof(metadata) = 'object'),
  ADD CONSTRAINT tasks_properties_check CHECK (jsonb_typeof(properties) = 'object' AND pg_column_size(properties) <= 16384),
  ADD CONSTRAINT tasks_stage_check CHECK (stage IS NULL OR stage >= 1);
