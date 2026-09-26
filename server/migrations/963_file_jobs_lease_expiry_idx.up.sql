-- Lease recovery scan: leased jobs whose lease has expired and may be retaken.
CREATE INDEX CONCURRENTLY idx_file_jobs_lease_expiry
  ON file_jobs (lease_expires_at) WHERE status = 'leased';
