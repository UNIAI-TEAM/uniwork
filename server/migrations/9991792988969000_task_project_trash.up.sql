-- UNI-2171: deleting a task or project moves it to the trash for 30 days.
-- Same shape as the document trash: the row stays, readers skip it, a worker
-- purges it. trash_batch_id groups a task subtree so one restore brings back
-- one batch; trashed_project_id remembers the project a task was unlinked
-- from while its project sits in the trash.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trashed_by TEXT,
  ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trash_batch_id TEXT,
  ADD COLUMN IF NOT EXISTS trashed_project_id TEXT;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trashed_by TEXT,
  ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ;
