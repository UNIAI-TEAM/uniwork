CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_member_profiles_department ON organization_member_profiles(organization_id, department_id);
