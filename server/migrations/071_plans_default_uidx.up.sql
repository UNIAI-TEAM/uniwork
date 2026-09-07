CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_plans_default_once ON plans (is_default) WHERE is_default;
