CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_member_profiles_search ON organization_member_profiles USING gin (search_text gin_trgm_ops);
