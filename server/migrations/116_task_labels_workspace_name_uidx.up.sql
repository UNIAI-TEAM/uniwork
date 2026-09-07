CREATE UNIQUE INDEX CONCURRENTLY idx_task_labels_workspace_name ON task_labels(workspace_id, lower(name)) WHERE archived_at IS NULL;
