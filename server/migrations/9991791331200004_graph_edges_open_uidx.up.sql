CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_graph_edges_open ON graph_edges (organization_id, from_node, to_node, edge_type, origin) WHERE valid_to IS NULL;
