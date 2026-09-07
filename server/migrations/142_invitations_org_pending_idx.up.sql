CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invitations_org_pending ON invitations(organization_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
