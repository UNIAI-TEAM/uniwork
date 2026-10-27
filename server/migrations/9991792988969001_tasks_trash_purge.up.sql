CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_trash_purge
  ON tasks (purge_after) WHERE trashed_at IS NOT NULL;
