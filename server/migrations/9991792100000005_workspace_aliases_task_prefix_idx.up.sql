CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workspace_aliases_task_prefix
  ON workspace_aliases (upper(value)) WHERE kind = 'task_prefix';
