-- Re-subscribing from the same browser upserts on the endpoint.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_push_subscriptions_endpoint
  ON push_subscriptions (endpoint) WHERE revoked_at IS NULL;
