CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_node_facts_history ON graph_node_facts (node_id, fact_type, valid_from);
