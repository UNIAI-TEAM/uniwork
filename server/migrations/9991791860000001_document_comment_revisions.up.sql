-- G8-03 (UNI-1398): the edit history (UNI-1335). One row per edit holds the
-- body that was replaced and the revision number that body carried (OQ-C3);
-- the current content stays on document_comments. Rows are deleted for real
-- with their comment (Q8) - there is no soft delete here. No FOREIGN KEY
-- (CLAUDE.md): tenancy and cleanup are service code, inside the transaction
-- that writes the edit.
CREATE TABLE document_comment_revisions (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  document_id      TEXT NOT NULL,
  comment_id       TEXT NOT NULL,
  body             TEXT NOT NULL,
  revision         BIGINT NOT NULL,
  created_by       TEXT NOT NULL,
  created_by_kind  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT document_comment_revisions_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system'))
);
