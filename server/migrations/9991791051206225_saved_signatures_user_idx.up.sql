-- The signature list is one user's rows in one organization, newest first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_saved_signatures_user
  ON saved_signatures (organization_id, user_id, created_at DESC);
