CREATE INDEX CONCURRENTLY idx_projects_workspace ON projects(workspace_id, updated_at DESC);
