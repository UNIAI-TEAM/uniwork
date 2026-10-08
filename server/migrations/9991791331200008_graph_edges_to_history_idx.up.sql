CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_edges_to_history ON graph_edges (to_node, valid_from);
