CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_edges_evidence ON graph_edges (organization_id, evidence_kind, evidence_id);
