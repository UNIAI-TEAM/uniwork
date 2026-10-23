CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_office_offline_leases_user_live
  ON office_offline_leases (user_id, organization_id) WHERE revoked_at IS NULL;
