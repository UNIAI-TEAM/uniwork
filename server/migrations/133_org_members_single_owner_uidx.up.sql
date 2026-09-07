CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_org_members_single_owner ON organization_members(organization_id) WHERE role = 'owner' AND deactivated_at IS NULL;
