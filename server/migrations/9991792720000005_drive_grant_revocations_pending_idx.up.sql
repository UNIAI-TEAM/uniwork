CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drive_grant_revocations_pending_idx
  ON drive_grant_revocations (requested_at)
  WHERE resolved_at IS NULL AND refresh_token_enc IS NOT NULL;
