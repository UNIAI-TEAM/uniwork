CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_office_offline_leases_device_doc
  ON office_offline_leases (device_session_id, document_id);
