CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_departments_org_code ON departments(organization_id, code) WHERE code IS NOT NULL AND archived_at IS NULL;
