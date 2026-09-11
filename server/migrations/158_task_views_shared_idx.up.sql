CREATE INDEX CONCURRENTLY idx_task_views_shared
  ON task_views (workspace_id, scope_type, scope_id)
  WHERE visibility = 'workspace';
