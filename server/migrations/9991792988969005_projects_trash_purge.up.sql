CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_trash_purge
  ON projects (purge_after) WHERE trashed_at IS NOT NULL;
