-- Daily expiry sweep: staged sessions whose claim deadline has passed.
CREATE INDEX CONCURRENTLY idx_file_upload_sessions_claim_expiry
  ON file_upload_sessions (claim_expires_at) WHERE status = 'staged';
