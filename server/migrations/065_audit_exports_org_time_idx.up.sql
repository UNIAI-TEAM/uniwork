CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_exports_org_time ON audit_exports (organization_id, created_at DESC);
