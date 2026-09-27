-- The favorites list is one user's rows in one organization, newest first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_favorites_user
  ON document_favorites (organization_id, user_id, created_at DESC);
