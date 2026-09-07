CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_member_profiles_employee_code ON organization_member_profiles(organization_id, employee_code) WHERE employee_code IS NOT NULL;
