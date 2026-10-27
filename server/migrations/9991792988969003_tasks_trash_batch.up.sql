CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_trash_batch
  ON tasks (workspace_id, trash_batch_id) WHERE trash_batch_id IS NOT NULL;
