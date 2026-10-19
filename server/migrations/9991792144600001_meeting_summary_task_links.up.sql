-- UNI-1853 (H2): which action item of which meeting summary became which
-- task. A summary is append-only and its action items are addressed by their
-- position in the stored array (item_index). The service writes these rows in
-- the same transaction as the tasks and refuses an item that already links a
-- task that still exists, so a second host or a second click cannot turn the
-- same item into two tasks. Tasks are hard-deleted and nothing cascades (no
-- FOREIGN KEY): a link whose task is gone is history, and the service reads
-- only links that still join a task, which frees the item again.
CREATE TABLE meeting_summary_task_links (
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
