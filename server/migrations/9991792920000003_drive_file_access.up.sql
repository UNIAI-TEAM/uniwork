-- Per-user Google Drive file access rows (UNI-2172, spec §6.3, ADR 0047).
-- Every content read resolves the connection through the requester's own row
-- (drive_connections.user_id = drive_file_access.user_id), never through
-- drive_files.connection_id of another user. No FOREIGN KEY (migration lint).
CREATE TABLE drive_file_access (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  drive_file_id    TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  connection_id    TEXT NOT NULL,
  state            TEXT NOT NULL DEFAULT 'granted',
  granted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT drive_file_access_ids_nonempty
    CHECK (
      id <> ''
      AND organization_id <> ''
      AND workspace_id <> ''
      AND drive_file_id <> ''
      AND user_id <> ''
      AND connection_id <> ''
    ),
  CONSTRAINT drive_file_access_state_check
    CHECK (state IN ('granted', 'lost'))
);
