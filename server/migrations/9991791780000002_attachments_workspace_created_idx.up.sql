-- Documents "other sources" (UNI-1305 item C): task attachments of a workspace,
-- newest first, bound to a task or a comment (staged rows are not listed).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attachments_workspace_created
  ON attachments (workspace_id, created_at DESC, id COLLATE "C" DESC)
  WHERE task_id IS NOT NULL OR comment_id IS NOT NULL;
