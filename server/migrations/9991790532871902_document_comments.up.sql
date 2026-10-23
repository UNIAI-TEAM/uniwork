-- Document comments (plan G1-07; UNI-681). Task comments keep task_comments;
-- documents get their own table behind the shared comment core in
-- server/internal/service/comments.go. Mirrors task_comments minus the
-- chat-mirror columns: threaded replies by parent_comment_id, revision bumps
-- on edit/resolve, and a narrow comment_type - a public client never writes
-- a system row. No FOREIGN KEY (CLAUDE.md): tenancy is enforced by the
-- organization/workspace columns on every query and deletes by service code.
CREATE TABLE document_comments (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  document_id      TEXT NOT NULL,
  parent_comment_id TEXT,
  author_id        TEXT NOT NULL,
  author_kind      TEXT NOT NULL,
  body             TEXT NOT NULL,
  comment_type     TEXT NOT NULL DEFAULT 'comment',
  revision         BIGINT NOT NULL DEFAULT 1,
  resolved_at      TIMESTAMPTZ,
  resolved_by_type TEXT,
  resolved_by_id   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT document_comments_author_kind_check
    CHECK (author_kind IN ('human', 'agent', 'system')),
  CONSTRAINT document_comments_comment_type_check
    CHECK (comment_type IN ('comment')),
  CONSTRAINT document_comments_resolved_by_type_check
    CHECK (resolved_by_type IS NULL OR resolved_by_type IN ('member', 'agent', 'system')),
  CONSTRAINT document_comments_resolved_consistency_check
    CHECK (
      (resolved_at IS NULL AND resolved_by_type IS NULL AND resolved_by_id IS NULL)
      OR (resolved_at IS NOT NULL AND resolved_by_type IS NOT NULL AND resolved_by_id IS NOT NULL)
    )
);
