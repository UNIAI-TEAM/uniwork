CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_nodes_workspace ON graph_nodes (organization_id, workspace_id, node_type, updated_at);
