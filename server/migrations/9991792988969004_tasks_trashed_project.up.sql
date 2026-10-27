CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_trashed_project
  ON tasks (trashed_project_id) WHERE trashed_project_id IS NOT NULL;
