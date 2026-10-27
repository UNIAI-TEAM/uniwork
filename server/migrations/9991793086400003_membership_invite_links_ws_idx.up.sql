CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_membership_invite_links_workspace
  ON membership_invite_links (workspace_id, created_at DESC)
  WHERE workspace_id IS NOT NULL;
