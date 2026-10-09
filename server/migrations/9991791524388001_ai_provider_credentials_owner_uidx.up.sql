-- One credential per provider for a person in an organization; the upsert in
-- ai_credentials.sql conflicts on it, and the list reads by its prefix.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_provider_credentials_owner
  ON ai_provider_credentials (organization_id, user_id, provider);
