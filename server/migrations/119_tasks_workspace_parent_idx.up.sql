CREATE INDEX CONCURRENTLY idx_tasks_workspace_parent ON tasks(workspace_id, parent_task_id);
