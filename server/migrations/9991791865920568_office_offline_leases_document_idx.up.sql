CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_office_offline_leases_document_live
  ON office_offline_leases (document_id) WHERE revoked_at IS NULL;
