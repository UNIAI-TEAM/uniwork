CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_graph_node_facts_open ON graph_node_facts (organization_id, node_id, fact_type) WHERE valid_to IS NULL;
