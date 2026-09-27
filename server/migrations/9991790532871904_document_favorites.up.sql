-- Server-side document favorites (plan G1-07; UNI-681): one row per
-- (document, user), synchronized across sessions - no localStorage. The
-- (document_id, user_id) unique pair makes add idempotent; every list read
-- re-filters by the reader's live document level in service code.
CREATE TABLE document_favorites (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  document_id     TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  created_by_kind TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT document_favorites_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system')),
  UNIQUE (document_id, user_id)
);
