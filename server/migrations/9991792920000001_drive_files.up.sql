-- Google Drive file references in a workspace (UNI-2172, spec §6.2, ADR 0047).
-- Stores metadata snapshots and bound connection identity only, never file bytes.
-- No FOREIGN KEY (migration lint).
CREATE TABLE drive_files (
  id                         TEXT PRIMARY KEY,
  organization_id            TEXT NOT NULL,
  workspace_id               TEXT NOT NULL,
  external_file_id           TEXT NOT NULL,
  drive_id                   TEXT,
  connection_id              TEXT NOT NULL,
  bound_by                   TEXT NOT NULL,
  created_by                 TEXT NOT NULL,
  created_by_kind            TEXT NOT NULL DEFAULT 'human',
  name                       TEXT NOT NULL DEFAULT '',
  mime_type                  TEXT NOT NULL DEFAULT '',
  icon_kind                  TEXT NOT NULL DEFAULT 'generic',
  web_view_link              TEXT NOT NULL DEFAULT '',
  owner_display              TEXT NOT NULL DEFAULT '',
  drive_modified_at          TIMESTAMPTZ,
  drive_modified_by_display  TEXT NOT NULL DEFAULT '',
  sharing_state              TEXT NOT NULL DEFAULT 'unknown',
  shared_user_count          INTEGER,
  metadata_refreshed_at      TIMESTAMPTZ,
  access_lost_at             TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  unlinked_at                TIMESTAMPTZ,
  unlinked_by                TEXT,
  unlinked_by_kind           TEXT,

  CONSTRAINT drive_files_ids_nonempty
    CHECK (
      id <> ''
      AND organization_id <> ''
      AND workspace_id <> ''
      AND external_file_id <> ''
      AND connection_id <> ''
      AND bound_by <> ''
      AND created_by <> ''
    ),
  CONSTRAINT drive_files_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT drive_files_unlinked_by_kind_check
    CHECK (unlinked_by_kind IS NULL OR unlinked_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT drive_files_sharing_state_check
    CHECK (sharing_state IN ('private', 'shared', 'unknown'))
);
