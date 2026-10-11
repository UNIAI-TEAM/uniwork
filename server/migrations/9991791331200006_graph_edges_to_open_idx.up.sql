CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_edges_to_open ON graph_edges (to_node, edge_type) WHERE valid_to IS NULL;
