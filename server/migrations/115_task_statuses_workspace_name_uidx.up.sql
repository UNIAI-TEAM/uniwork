CREATE UNIQUE INDEX CONCURRENTLY idx_task_statuses_workspace_name ON task_statuses(workspace_id, lower(name)) WHERE archived_at IS NULL;
