-- Work Graph load set (C-11 §8): ~5 edges per real task of one perf org.
-- psql -v org_id=<id> -v tag=graphload -f scripts/load/graph-seed.sql
-- Run on an org reserved for load: rebuild/verify treats these edges as drift.
\set ON_ERROR_STOP on
CREATE TEMP TABLE seed_tasks AS
  SELECT t.id, t.workspace_id, row_number() OVER (ORDER BY t.id) AS n
  FROM tasks t WHERE t.organization_id = :'org_id';
CREATE TEMP TABLE seed_members AS
  SELECT m.user_id AS id, row_number() OVER (ORDER BY m.user_id) AS n
  FROM organization_members m WHERE m.organization_id = :'org_id';
INSERT INTO graph_nodes (id, organization_id, workspace_id, node_type, source_id, title, visibility)
SELECT :'tag' || '-gt-' || n, :'org_id', workspace_id, 'TASK', id, 'Việc ' || n, 'workspace' FROM seed_tasks
ON CONFLICT DO NOTHING;
INSERT INTO graph_nodes (id, organization_id, node_type, subtype, source_id, title, visibility)
SELECT :'tag' || '-ga-' || n, :'org_id', 'ACTOR', 'member', id, 'Người ' || n, 'organization' FROM seed_members
ON CONFLICT DO NOTHING;
-- Edges join nodes by source id, so nodes a projector already wrote are reused.
CREATE TEMP TABLE seed_task_nodes AS
  SELECT s.n, g.id AS node_id FROM seed_tasks s
  JOIN graph_nodes g ON g.organization_id = :'org_id' AND g.node_type = 'TASK' AND g.source_id = s.id;
CREATE TEMP TABLE seed_actor_nodes AS
  SELECT m.n, g.id AS node_id FROM seed_members m
  JOIN graph_nodes g ON g.organization_id = :'org_id' AND g.node_type = 'ACTOR' AND g.source_id = m.id;
SELECT count(*) AS tasks FROM seed_task_nodes \gset
SELECT count(*) AS actors FROM seed_actor_nodes \gset
INSERT INTO graph_edges (id, organization_id, from_node, to_node, edge_type, origin, valid_from, evidence_kind, evidence_id)
SELECT :'tag' || '-eo-' || t.n, :'org_id', t.node_id, a.node_id, 'OWNED_BY', 'SYSTEM', now() - interval '30 days', 'source_row', :'tag'
FROM seed_task_nodes t JOIN seed_actor_nodes a ON a.n = 1 + (t.n % :actors)
ON CONFLICT DO NOTHING;
INSERT INTO graph_edges (id, organization_id, from_node, to_node, edge_type, origin, valid_from, evidence_kind, evidence_id)
SELECT :'tag' || '-eb-' || t.n, :'org_id', t.node_id, p.node_id, 'BELONGS_TO', 'SYSTEM', now() - interval '20 days', 'source_row', :'tag'
FROM seed_task_nodes t JOIN seed_task_nodes p ON p.n = 1 + ((t.n * 7) % :tasks)
WHERE p.n <> t.n
ON CONFLICT DO NOTHING;
INSERT INTO graph_edges (id, organization_id, from_node, to_node, edge_type, origin, valid_from, evidence_kind, evidence_id)
SELECT :'tag' || '-ed-' || t.n || '-' || k, :'org_id', t.node_id, d.node_id, 'DEPENDS_ON', 'SYSTEM', now() - interval '10 days', 'source_row', :'tag'
FROM seed_task_nodes t CROSS JOIN generate_series(1, 3) k
JOIN seed_task_nodes d ON d.n = 1 + ((t.n * 13 + k * 101) % :tasks)
WHERE d.n <> t.n
ON CONFLICT DO NOTHING;
ANALYZE graph_nodes;
ANALYZE graph_edges;
