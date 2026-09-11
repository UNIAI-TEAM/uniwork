CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_org_live ON subscriptions (organization_id) WHERE status <> 'canceled';
