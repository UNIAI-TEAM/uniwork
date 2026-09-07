-- Backs ListActivePushSubscriptions for one user at send time.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions (user_id) WHERE revoked_at IS NULL;
