-- Google Drive folder metadata nodes in a workspace (UNI-2291, ADR 0007, ADR 0008, ADR 0047).
-- Stores only folder metadata (name, parent_folder_id) resolved via a member's own
-- drive.file connection; never stores Drive content bytes. No FOREIGN KEY (migration lint).
CREATE TABLE drive_folders (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  connection_id     TEXT NOT NULL,
  drive_folder_id   TEXT NOT NULL,
  name              TEXT NOT NULL,
  parent_folder_id  TEXT,
  refreshed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        TEXT NOT NULL,
  created_by_kind   TEXT NOT NULL DEFAULT 'human',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT drive_folders_ids_nonempty
    CHECK (
      id <> ''
      AND organization_id <> ''
      AND workspace_id <> ''
      AND connection_id <> ''
      AND drive_folder_id <> ''
      AND name <> ''
      AND (parent_folder_id IS NULL OR parent_folder_id <> '')
      AND parent_folder_id IS DISTINCT FROM drive_folder_id
      AND created_by <> ''
    ),
  CONSTRAINT drive_folders_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system'))
);
