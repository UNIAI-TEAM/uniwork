CREATE INDEX CONCURRENTLY idx_task_pins_user ON task_pins(workspace_id, user_id, position);
