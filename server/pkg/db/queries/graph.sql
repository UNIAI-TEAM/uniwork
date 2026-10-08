-- Work Graph writes (C-11). Only internal/graph/projector calls these
-- (TestGraphTablesWrittenOnlyByProjector).

-- name: GraphLockNode :exec
-- Serializes projections of one node across workers and the rebuild.
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(lock_key)::text, 0));

-- name: GraphGetNodeBySource :one
SELECT * FROM graph_nodes
WHERE organization_id = sqlc.arg(organization_id) AND node_type = sqlc.arg(node_type) AND source_id = sqlc.arg(source_id);

-- name: GraphUpsertNode :one
-- Returns no row when nothing changed: the caller reads the node instead, so
-- a re-projection does not touch updated_at.
INSERT INTO graph_nodes (id, organization_id, workspace_id, node_type, subtype, source_id, title, status,
                         visibility, reader_ids, occurred_at, source_updated_at)
VALUES (sqlc.arg(id), sqlc.arg(organization_id), sqlc.narg(workspace_id), sqlc.arg(node_type), sqlc.arg(subtype),
        sqlc.arg(source_id), sqlc.arg(title), sqlc.arg(status), sqlc.arg(visibility),
        -- pgx sends a nil []string as NULL; the column is NOT NULL.
        COALESCE(sqlc.arg(reader_ids)::text[], '{}'::text[]),
        sqlc.narg(occurred_at), sqlc.narg(source_updated_at))
ON CONFLICT (organization_id, node_type, source_id) DO UPDATE SET
  workspace_id = EXCLUDED.workspace_id, subtype = EXCLUDED.subtype, title = EXCLUDED.title,
  status = EXCLUDED.status, visibility = EXCLUDED.visibility, reader_ids = EXCLUDED.reader_ids,
  occurred_at = EXCLUDED.occurred_at, source_updated_at = EXCLUDED.source_updated_at,
  deleted_at = NULL, updated_at = now()
WHERE (graph_nodes.workspace_id, graph_nodes.subtype, graph_nodes.title, graph_nodes.status, graph_nodes.visibility,
       graph_nodes.reader_ids, graph_nodes.occurred_at, graph_nodes.source_updated_at, graph_nodes.deleted_at)
  IS DISTINCT FROM
      (EXCLUDED.workspace_id, EXCLUDED.subtype, EXCLUDED.title, EXCLUDED.status, EXCLUDED.visibility,
       EXCLUDED.reader_ids, EXCLUDED.occurred_at, EXCLUDED.source_updated_at, NULL::timestamptz)
RETURNING *;

-- name: GraphMarkNodeDeleted :exec
UPDATE graph_nodes SET deleted_at = sqlc.arg(at)::timestamptz, updated_at = now()
WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: GraphListOpenSystemEdges :many
-- Every open SYSTEM edge touching a node, with the other end named by source.
-- peer_deleted: two projections can race (each holds only its own lock), so
-- an edge can stay open to a peer whose deletion did not see it.
SELECT e.id, e.edge_type, (e.from_node = sqlc.arg(node_id)::text) AS outgoing,
       p.node_type AS peer_type, p.source_id AS peer_source_id,
       (p.deleted_at IS NOT NULL)::boolean AS peer_deleted
FROM graph_edges e
JOIN graph_nodes p ON p.id = CASE WHEN e.from_node = sqlc.arg(node_id)::text THEN e.to_node ELSE e.from_node END
WHERE e.organization_id = sqlc.arg(organization_id)
  AND (e.from_node = sqlc.arg(node_id)::text OR e.to_node = sqlc.arg(node_id)::text)
  AND e.origin = 'SYSTEM' AND e.valid_to IS NULL;

-- name: GraphListPeersOfEdgesClosedSince :many
-- The other ends of the SYSTEM edges at a node that closed at or after
-- since: when a deleted node comes back, the owners of the edges its
-- deletion closed re-project to reopen them.
SELECT DISTINCT p.node_type AS peer_type, p.source_id AS peer_source_id
FROM graph_edges e
JOIN graph_nodes p ON p.id = CASE WHEN e.from_node = sqlc.arg(node_id)::text THEN e.to_node ELSE e.from_node END
WHERE e.organization_id = sqlc.arg(organization_id)
  AND (e.from_node = sqlc.arg(node_id)::text OR e.to_node = sqlc.arg(node_id)::text)
  AND e.origin = 'SYSTEM' AND e.valid_to >= sqlc.arg(since)::timestamptz;

-- name: GraphOpenEdge :exec
INSERT INTO graph_edges (id, organization_id, from_node, to_node, edge_type, origin, valid_from,
                         evidence_kind, evidence_id, actor_kind, actor_id, attrs)
VALUES (sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(from_node), sqlc.arg(to_node), sqlc.arg(edge_type),
        sqlc.arg(origin), sqlc.arg(valid_from), sqlc.arg(evidence_kind), sqlc.arg(evidence_id),
        sqlc.arg(actor_kind), sqlc.arg(actor_id), sqlc.arg(attrs)::jsonb)
ON CONFLICT (organization_id, from_node, to_node, edge_type, origin) WHERE valid_to IS NULL DO NOTHING;

-- name: GraphCloseEdge :exec
UPDATE graph_edges
SET valid_to = GREATEST(valid_from, sqlc.arg(valid_to)::timestamptz),
    attrs = attrs || jsonb_build_object('closed_by', sqlc.arg(closed_by)::text)
WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id) AND valid_to IS NULL;

-- name: GraphCloseNodeEdges :exec
-- A deleted source closes every open edge at either end, whatever its origin.
UPDATE graph_edges
SET valid_to = GREATEST(valid_from, sqlc.arg(valid_to)::timestamptz),
    attrs = attrs || jsonb_build_object('closed_by', sqlc.arg(closed_by)::text)
WHERE organization_id = sqlc.arg(organization_id)
  AND (from_node = sqlc.arg(node_id)::text OR to_node = sqlc.arg(node_id)::text) AND valid_to IS NULL;

-- name: GraphListOpenFacts :many
SELECT * FROM graph_node_facts
WHERE organization_id = sqlc.arg(organization_id) AND node_id = sqlc.arg(node_id) AND valid_to IS NULL;

-- name: GraphOpenFact :exec
INSERT INTO graph_node_facts (id, organization_id, node_id, fact_type, value, valid_from, evidence_kind, evidence_id, attrs)
VALUES (sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(node_id), sqlc.arg(fact_type), sqlc.arg(value),
        sqlc.arg(valid_from), sqlc.arg(evidence_kind), sqlc.arg(evidence_id), sqlc.arg(attrs)::jsonb)
ON CONFLICT (organization_id, node_id, fact_type) WHERE valid_to IS NULL DO NOTHING;

-- name: GraphCloseFact :exec
UPDATE graph_node_facts SET valid_to = GREATEST(valid_from, sqlc.arg(valid_to)::timestamptz)
WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id) AND valid_to IS NULL;

-- name: GraphCloseNodeFacts :exec
UPDATE graph_node_facts SET valid_to = GREATEST(valid_from, sqlc.arg(valid_to)::timestamptz)
WHERE organization_id = sqlc.arg(organization_id) AND node_id = sqlc.arg(node_id) AND valid_to IS NULL;

-- name: GraphMarkDirty :exec
-- One upsert per event; node_types[i] pairs with source_ids[i] (deduplicated
-- by the caller: ON CONFLICT cannot touch one row twice in a statement).
-- The event fields move together and keep the latest event by time: lanes
-- run concurrently, so an older event can be marked after a newer one, and
-- the worker dates and attributes edges from this row. Any mark, older or
-- not, still re-dirties the node.
INSERT INTO graph_dirty (organization_id, node_type, source_id, last_event_id, last_event_at, actor_kind, actor_id)
SELECT sqlc.arg(organization_id)::text, unnest(sqlc.arg(node_types)::text[]), unnest(sqlc.arg(source_ids)::text[]),
       sqlc.arg(event_id)::text, sqlc.arg(event_at)::timestamptz, sqlc.arg(actor_kind)::text, sqlc.arg(actor_id)::text
ON CONFLICT (organization_id, node_type, source_id) DO UPDATE SET
  mark_seq = graph_dirty.mark_seq + 1,
  last_event_id = CASE WHEN EXCLUDED.last_event_at >= graph_dirty.last_event_at
                       THEN EXCLUDED.last_event_id ELSE graph_dirty.last_event_id END,
  last_event_at = GREATEST(graph_dirty.last_event_at, EXCLUDED.last_event_at),
  actor_kind = CASE WHEN EXCLUDED.last_event_at >= graph_dirty.last_event_at
                    THEN EXCLUDED.actor_kind ELSE graph_dirty.actor_kind END,
  actor_id = CASE WHEN EXCLUDED.last_event_at >= graph_dirty.last_event_at
                  THEN EXCLUDED.actor_id ELSE graph_dirty.actor_id END,
  available_at = LEAST(graph_dirty.available_at, now()),
  attempts = 0, last_error = '';

-- name: GraphClaimDirty :many
-- tenant: system
-- The worker claims across organizations; each row carries its own.
UPDATE graph_dirty d
SET locked_until = now() + make_interval(secs => sqlc.arg(lease_seconds)::int), attempts = d.attempts + 1
FROM (
  SELECT organization_id, node_type, source_id FROM graph_dirty
  WHERE available_at <= now() AND (locked_until IS NULL OR locked_until < now())
  ORDER BY available_at
  LIMIT sqlc.arg(batch)::int
  FOR UPDATE SKIP LOCKED
) c
WHERE d.organization_id = c.organization_id AND d.node_type = c.node_type AND d.source_id = c.source_id
RETURNING d.*;

-- name: GraphDoneDirty :execrows
DELETE FROM graph_dirty
WHERE organization_id = sqlc.arg(organization_id) AND node_type = sqlc.arg(node_type)
  AND source_id = sqlc.arg(source_id) AND mark_seq = sqlc.arg(mark_seq);

-- name: GraphReleaseDirty :exec
UPDATE graph_dirty SET locked_until = NULL, attempts = 0
WHERE organization_id = sqlc.arg(organization_id) AND node_type = sqlc.arg(node_type) AND source_id = sqlc.arg(source_id);

-- name: GraphFailDirty :exec
UPDATE graph_dirty SET locked_until = NULL, available_at = sqlc.arg(available_at), last_error = sqlc.arg(last_error)
WHERE organization_id = sqlc.arg(organization_id) AND node_type = sqlc.arg(node_type) AND source_id = sqlc.arg(source_id);

-- name: GraphListOrganizations :many
SELECT id FROM organizations ORDER BY id;

-- name: GraphRebuildLiveSources :many
SELECT source_id FROM graph_nodes
WHERE organization_id = sqlc.arg(organization_id) AND node_type = sqlc.arg(node_type) AND deleted_at IS NULL
  AND source_id > sqlc.arg(after_id)::text
ORDER BY source_id
LIMIT sqlc.arg(limit_n)::int;
