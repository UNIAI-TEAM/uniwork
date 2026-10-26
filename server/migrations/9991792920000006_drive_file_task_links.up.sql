-- Links between Google Drive file references and tasks (UNI-2172, spec §6.4).
-- Hard-deleted when removed from a task or when the Drive file is unlinked from
-- the workspace; task and file audit rows preserve the activity trail.
-- No FOREIGN KEY (migration lint).
CREATE TABLE drive_file_task_links (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  drive_file_id    TEXT NOT NULL,
  task_id          TEXT NOT NULL,
  created_by       TEXT NOT NULL,
  created_by_kind  TEXT NOT NULL DEFAULT 'human',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT drive_file_task_links_ids_nonempty
    CHECK (
      id <> ''
      AND organization_id <> ''
      AND workspace_id <> ''
      AND drive_file_id <> ''
      AND task_id <> ''
      AND created_by <> ''
    ),
  CONSTRAINT drive_file_task_links_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system'))
);
