ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_stage_check,
  DROP CONSTRAINT IF EXISTS tasks_properties_check,
  DROP CONSTRAINT IF EXISTS tasks_metadata_check,
  DROP CONSTRAINT IF EXISTS tasks_context_refs_check,
  DROP CONSTRAINT IF EXISTS tasks_acceptance_criteria_check,
  DROP CONSTRAINT IF EXISTS tasks_creator_type_check,
  DROP CONSTRAINT IF EXISTS tasks_assignee_type_check,
  DROP CONSTRAINT IF EXISTS tasks_priority_check;

UPDATE tasks SET status = 'todo' WHERE status NOT IN ('todo','in_progress','done','cancelled');
UPDATE tasks SET priority = 'medium' WHERE priority = 'none';

ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check CHECK (status IN ('todo','in_progress','done','cancelled')),
  ADD CONSTRAINT tasks_priority_check CHECK (priority IN ('low','medium','high','urgent'));

ALTER TABLE tasks
  DROP COLUMN IF EXISTS last_activity_at,
  DROP COLUMN IF EXISTS revision,
  DROP COLUMN IF EXISTS first_executed_at,
  DROP COLUMN IF EXISTS origin_id,
  DROP COLUMN IF EXISTS origin_type,
  DROP COLUMN IF EXISTS stage,
  DROP COLUMN IF EXISTS start_date,
  DROP COLUMN IF EXISTS properties,
  DROP COLUMN IF EXISTS metadata,
  DROP COLUMN IF EXISTS context_refs,
  DROP COLUMN IF EXISTS acceptance_criteria,
  DROP COLUMN IF EXISTS creator_id,
  DROP COLUMN IF EXISTS creator_type,
  DROP COLUMN IF EXISTS assignee_type,
  DROP COLUMN IF EXISTS parent_task_id,
  DROP COLUMN IF EXISTS project_id,
  DROP COLUMN IF EXISTS number,
  DROP COLUMN IF EXISTS organization_id;

ALTER TABLE workspaces
  DROP COLUMN IF EXISTS task_counter,
  DROP COLUMN IF EXISTS task_prefix;
