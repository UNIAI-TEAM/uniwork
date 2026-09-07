DROP TABLE IF EXISTS task_source_contexts;
DROP TABLE IF EXISTS attachments;
DROP TABLE IF EXISTS task_reactions;
DROP TABLE IF EXISTS comment_reactions;

ALTER TABLE task_comments
  DROP CONSTRAINT IF EXISTS task_comments_resolved_consistency_check,
  DROP CONSTRAINT IF EXISTS task_comments_resolved_by_type_check,
  DROP CONSTRAINT IF EXISTS task_comments_comment_type_check,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS revision,
  DROP COLUMN IF EXISTS resolved_by_id,
  DROP COLUMN IF EXISTS resolved_by_type,
  DROP COLUMN IF EXISTS resolved_at,
  DROP COLUMN IF EXISTS comment_type,
  DROP COLUMN IF EXISTS parent_comment_id,
  DROP COLUMN IF EXISTS workspace_id,
  DROP COLUMN IF EXISTS organization_id;
