CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_feature_flag_overrides_scope ON feature_flag_overrides (flag_key, scope_type, scope_id);
