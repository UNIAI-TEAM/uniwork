-- Backs CountUnreadNotifications: the sidebar badge, one probe per request.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, workspace_id) WHERE read_at IS NULL AND archived_at IS NULL;
