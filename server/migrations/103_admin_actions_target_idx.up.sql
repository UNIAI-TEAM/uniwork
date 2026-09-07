CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_actions_target ON admin_actions (target_type, target_id, created_at DESC);
