CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_workspace_aliases_slug
  ON workspace_aliases (organization_id, value) WHERE kind = 'slug';
