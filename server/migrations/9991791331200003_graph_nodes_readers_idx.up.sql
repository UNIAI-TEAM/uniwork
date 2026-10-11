CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_nodes_readers ON graph_nodes USING gin (reader_ids);
