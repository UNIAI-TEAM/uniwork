CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_departments_org ON departments(organization_id, sort_order) WHERE archived_at IS NULL;
