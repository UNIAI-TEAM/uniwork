CREATE UNIQUE INDEX CONCURRENTLY idx_task_statuses_workspace_key ON task_statuses(workspace_id, key);
