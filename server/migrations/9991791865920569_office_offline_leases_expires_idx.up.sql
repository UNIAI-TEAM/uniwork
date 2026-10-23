CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_office_offline_leases_expires
  ON office_offline_leases (expires_at);
