CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_edges_from_open ON graph_edges (from_node, edge_type) WHERE valid_to IS NULL;
