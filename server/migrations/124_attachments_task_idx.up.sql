CREATE INDEX CONCURRENTLY idx_attachments_task ON attachments(workspace_id, task_id) WHERE task_id IS NOT NULL;
