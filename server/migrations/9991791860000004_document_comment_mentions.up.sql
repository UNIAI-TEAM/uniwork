-- G8-03 (UNI-1398): durable mentions of a document comment. This migration
-- only creates the table, its constraints and purge path; the rows are
-- written and maintained by G8-05 (UNI-1331) together with the create/edit
-- transaction. notified_at stays NULL until the notification consumer claims
-- the row, which is what makes one mention notify exactly once (G8-D4). No
-- FOREIGN KEY (CLAUDE.md) and no soft delete: a removed mention keeps its row
-- while the comment lives.
CREATE TABLE document_comment_mentions (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  document_id      TEXT NOT NULL,
  comment_id       TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  state            TEXT NOT NULL,
  notified_at      TIMESTAMPTZ,
  created_by       TEXT NOT NULL,
  created_by_kind  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT document_comment_mentions_state_check
    CHECK (state IN ('active', 'removed', 'no_access')),
  CONSTRAINT document_comment_mentions_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system'))
);
