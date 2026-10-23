-- Document shares (C-01 §3.4; UNI-675). A share grants a principal - a user,
-- a whole workspace or the whole organization - a level on one document.
-- Revoke sets revoked_at instead of deleting: the table is also the history
-- of who ever had access, and re-granting inserts a new row. Principals must
-- belong to the same organization as the document (checked in service code,
-- no FK). Shares never inherit down the tree.
CREATE TABLE document_shares (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  document_id      TEXT NOT NULL,
  principal_type   TEXT NOT NULL,
  principal_id     TEXT NOT NULL,
  level            TEXT NOT NULL,
  granted_by       TEXT NOT NULL,
  granted_by_kind  TEXT NOT NULL,
  revoked_at       TIMESTAMPTZ,
  revoked_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT document_shares_principal_check
    CHECK (principal_type IN ('user', 'workspace', 'organization')),
  CONSTRAINT document_shares_level_check
    CHECK (level IN ('view', 'edit', 'manage')),
  CONSTRAINT document_shares_granted_by_kind_check
    CHECK (granted_by_kind IN ('human', 'agent', 'system'))
);
