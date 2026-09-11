CREATE INDEX CONCURRENTLY idx_attachments_comment ON attachments(workspace_id, comment_id) WHERE comment_id IS NOT NULL;
