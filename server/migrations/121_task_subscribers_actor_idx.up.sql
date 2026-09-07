CREATE INDEX CONCURRENTLY idx_task_subscribers_actor ON task_subscribers(workspace_id, actor_type, actor_id);
