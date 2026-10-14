-- G8-03 (UNI-1398): document comments grow the collaboration lane - a thread
-- kind (comment | discussion), the anchor columns and a structure-keeping soft
-- delete. Every existing row had no anchor, so it becomes a discussion (G8-D5);
-- there is no thread_kind column: comment_type is the one thread kind.
ALTER TABLE document_comments
  DROP CONSTRAINT document_comments_comment_type_check;

UPDATE document_comments SET comment_type = 'discussion';

ALTER TABLE document_comments
  ALTER COLUMN comment_type SET DEFAULT 'discussion',
  ADD COLUMN anchor JSONB,
  ADD COLUMN anchor_version_id TEXT,
  ADD COLUMN anchor_state TEXT,
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deleted_by_id TEXT,
  ADD COLUMN deleted_by_kind TEXT,
  ADD CONSTRAINT document_comments_comment_type_check
    CHECK (comment_type IN ('comment', 'discussion')),
  ADD CONSTRAINT document_comments_anchor_state_check
    CHECK (anchor_state IS NULL OR anchor_state IN ('exact', 'stale', 'lost')),
  ADD CONSTRAINT document_comments_anchor_consistency_check
    CHECK (
      (anchor IS NULL) = (anchor_version_id IS NULL)
      AND (anchor IS NULL) = (anchor_state IS NULL)
    ),
  ADD CONSTRAINT document_comments_anchor_root_only_check
    CHECK (anchor IS NULL OR (comment_type = 'comment' AND parent_comment_id IS NULL)),
  ADD CONSTRAINT document_comments_deleted_by_kind_check
    CHECK (deleted_by_kind IS NULL OR deleted_by_kind IN ('human', 'agent', 'system')),
  ADD CONSTRAINT document_comments_deleted_consistency_check
    CHECK (
      (deleted_at IS NULL) = (deleted_by_id IS NULL)
      AND (deleted_at IS NULL) = (deleted_by_kind IS NULL)
    );
