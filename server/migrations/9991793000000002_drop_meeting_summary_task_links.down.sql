-- Recreates meeting_summary_task_links empty, as 9991792144600001/2 made it,
-- so the down migrations of UNI-1998 and earlier still find the table. The
-- rows are not restored: meeting_action_items holds what they said. The index
-- is built plainly here because the table is empty.
CREATE TABLE IF NOT EXISTS meeting_summary_task_links (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  meeting_id       TEXT NOT NULL,
  summary_id       TEXT NOT NULL,
  item_index       INT  NOT NULL,
  task_id          TEXT NOT NULL,
  created_by       TEXT NOT NULL,
  created_by_kind  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meeting_summary_task_links_item_index_check CHECK (item_index >= 0),
  CONSTRAINT meeting_summary_task_links_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system'))
);
CREATE INDEX IF NOT EXISTS idx_meeting_summary_task_links_summary
  ON meeting_summary_task_links (summary_id);
