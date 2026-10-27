ALTER TABLE projects
  DROP COLUMN IF EXISTS purge_after,
  DROP COLUMN IF EXISTS trashed_by,
  DROP COLUMN IF EXISTS trashed_at;

ALTER TABLE tasks
  DROP COLUMN IF EXISTS trashed_project_id,
  DROP COLUMN IF EXISTS trash_batch_id,
  DROP COLUMN IF EXISTS purge_after,
  DROP COLUMN IF EXISTS trashed_by,
  DROP COLUMN IF EXISTS trashed_at;
