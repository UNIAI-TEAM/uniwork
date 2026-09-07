-- Backs ListNotifications: my inbox, newest first, archived rows out.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_time
  ON notifications (user_id, created_at DESC) WHERE archived_at IS NULL;
