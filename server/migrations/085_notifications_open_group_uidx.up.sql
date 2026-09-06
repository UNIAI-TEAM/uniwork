-- The merge mechanism: one open (unread, not archived) row per group per user.
-- UpsertNotification's ON CONFLICT targets this partial index, so a second
-- event on the same entity bumps count instead of adding a row; a read row
-- no longer matches, and the next event starts a fresh one.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_notifications_open_group
  ON notifications (user_id, group_key) WHERE read_at IS NULL AND archived_at IS NULL;
