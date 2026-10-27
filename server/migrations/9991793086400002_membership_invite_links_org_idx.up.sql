CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_membership_invite_links_org
  ON membership_invite_links (organization_id, created_at DESC);
