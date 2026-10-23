CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_office_launch_sessions_scope ON office_launch_sessions(organization_id, workspace_id, document_id, created_at DESC);
