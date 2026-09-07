CREATE INDEX CONCURRENTLY idx_task_dependencies_task ON task_dependencies(workspace_id, task_id);
