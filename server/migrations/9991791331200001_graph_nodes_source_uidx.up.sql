CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_graph_nodes_source ON graph_nodes (organization_id, node_type, source_id);
