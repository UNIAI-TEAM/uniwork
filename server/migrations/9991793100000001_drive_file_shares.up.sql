CREATE TABLE drive_file_shares (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  drive_file_id    TEXT NOT NULL,
  principal_type   TEXT NOT NULL,
  principal_id     TEXT NOT NULL,
  level            TEXT NOT NULL DEFAULT 'view',
  created_by       TEXT NOT NULL,
  created_by_kind  TEXT NOT NULL DEFAULT 'human',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ,
  revoked_by       TEXT,
  revoked_by_kind  TEXT,

  CONSTRAINT drive_file_shares_ids_nonempty
    CHECK (
      id <> ''
      AND organization_id <> ''
      AND workspace_id <> ''
      AND drive_file_id <> ''
      AND principal_id <> ''
      AND created_by <> ''
    ),
  CONSTRAINT drive_file_shares_principal_type_check
    CHECK (principal_type IN ('user', 'workspace', 'organization')),
  CONSTRAINT drive_file_shares_level_check
    CHECK (level IN ('view')),
  CONSTRAINT drive_file_shares_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT drive_file_shares_revoked_by_kind_check
    CHECK (revoked_by_kind IS NULL OR revoked_by_kind IN ('human', 'agent', 'system'))
);
