CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_office_offline_leases_org_live
  ON office_offline_leases (organization_id) WHERE revoked_at IS NULL;
