CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_trash_list
  ON tasks (workspace_id, trashed_at DESC) WHERE trashed_at IS NOT NULL;
