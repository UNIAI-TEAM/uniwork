CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_trash_list
  ON projects (workspace_id, trashed_at DESC) WHERE trashed_at IS NOT NULL;
