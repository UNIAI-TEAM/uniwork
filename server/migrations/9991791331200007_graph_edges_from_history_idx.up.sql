CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_edges_from_history ON graph_edges (from_node, valid_from);
