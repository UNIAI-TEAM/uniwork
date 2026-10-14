-- The inverse of the up file: no thread kind, anchor or soft-delete columns
-- exist before G8-03; tombstoned rows lose their frame but keep their rows.
ALTER TABLE document_comments
  DROP CONSTRAINT document_comments_comment_type_check,
  DROP CONSTRAINT document_comments_deleted_consistency_check,
  DROP CONSTRAINT document_comments_deleted_by_kind_check,
  DROP CONSTRAINT document_comments_anchor_root_only_check,
  DROP CONSTRAINT document_comments_anchor_consistency_check,
  DROP CONSTRAINT document_comments_anchor_state_check,
  ALTER COLUMN comment_type SET DEFAULT 'comment',
  DROP COLUMN anchor,
  DROP COLUMN anchor_version_id,
  DROP COLUMN anchor_state,
  DROP COLUMN deleted_at,
  DROP COLUMN deleted_by_id,
  DROP COLUMN deleted_by_kind;

UPDATE document_comments SET comment_type = 'comment';

ALTER TABLE document_comments
  ADD CONSTRAINT document_comments_comment_type_check
    CHECK (comment_type IN ('comment'));
