-- Tombstones cannot be represented by the previous schema. Delete them before
-- dropping their state columns so rollback never turns an opt-out into a live
-- manual subscription. Active subscriptions remain valid legacy rows.
DELETE FROM task_subscribers
WHERE unsubscribed_at IS NOT NULL;

ALTER TABLE task_subscribers
  DROP COLUMN opt_out_scope,
  DROP COLUMN unsubscribed_at;
