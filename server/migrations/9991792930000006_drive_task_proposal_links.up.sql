-- Durable provenance links between tasks and the Drive task proposal items that created them (UNI-2181, spec §6.6).
-- Preserved across proposal retention sweeps and Drive file unlink/relink cycles.
-- No FOREIGN KEY (migration lint).
CREATE TABLE drive_task_proposal_links (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  proposal_id       TEXT NOT NULL,
  item_index        INTEGER NOT NULL,
  task_id           TEXT NOT NULL,
  drive_file_id     TEXT NOT NULL,
  external_file_id  TEXT NOT NULL,
  created_by        TEXT NOT NULL,
  created_by_kind   TEXT NOT NULL DEFAULT 'human',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT drive_task_proposal_links_ids_nonempty
    CHECK (
      id <> ''
      AND organization_id <> ''
      AND workspace_id <> ''
      AND proposal_id <> ''
      AND task_id <> ''
      AND drive_file_id <> ''
      AND external_file_id <> ''
      AND created_by <> ''
    ),
  CONSTRAINT drive_task_proposal_links_item_index_check
    CHECK (item_index >= 0),
  CONSTRAINT drive_task_proposal_links_created_by_kind_check
    CHECK (created_by_kind IN ('human'))
);
