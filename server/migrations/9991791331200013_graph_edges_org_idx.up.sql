CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_edges_org ON graph_edges (organization_id, edge_type, valid_from);
