CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_office_offline_leases_revoked
  ON office_offline_leases (revoked_at) WHERE revoked_at IS NOT NULL;
