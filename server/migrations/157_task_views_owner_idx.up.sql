CREATE INDEX CONCURRENTLY idx_task_views_owner
  ON task_views (workspace_id, scope_type, scope_id, owner_id);
