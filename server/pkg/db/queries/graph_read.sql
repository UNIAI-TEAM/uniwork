-- Work Graph reads for the API (C-11 §6). Layer 1: same organization, and the
-- node's visibility admits the caller (workspace ids come from
-- OrganizationService.ListWorkspaces, never from a membership join here).

-- name: GraphGetVisibleNode :one
SELECT n.id, n.node_type, n.subtype, n.source_id, n.title, n.status,
       COALESCE(n.workspace_id, '')::text AS workspace_id, COALESCE(w.slug, '')::text AS workspace_slug
FROM graph_nodes n
LEFT JOIN workspaces w ON w.id = n.workspace_id
WHERE n.organization_id = sqlc.arg(organization_id) AND n.node_type = sqlc.arg(node_type)
  AND n.source_id = sqlc.arg(source_id) AND n.deleted_at IS NULL
  AND (n.visibility = 'organization'
       OR (n.visibility = 'workspace' AND n.workspace_id = ANY(sqlc.arg(workspace_ids)::text[]))
       OR (n.visibility IN ('members', 'private') AND n.reader_ids @> ARRAY[sqlc.arg(user_id)::text]));

-- name: GraphListNeighbors :many
SELECT e.id AS edge_id, e.edge_type, e.origin, e.valid_from, e.attrs,
       (e.from_node = sqlc.arg(node_id)::text) AS outgoing,
       p.node_type AS peer_type, p.subtype AS peer_subtype, p.source_id AS peer_source_id,
       p.title AS peer_title, p.status AS peer_status,
       COALESCE(p.workspace_id, '')::text AS peer_workspace_id, COALESCE(w.slug, '')::text AS peer_workspace_slug
FROM graph_edges e
JOIN graph_nodes p ON p.id = CASE WHEN e.from_node = sqlc.arg(node_id)::text THEN e.to_node ELSE e.from_node END
LEFT JOIN workspaces w ON w.id = p.workspace_id
WHERE e.organization_id = sqlc.arg(organization_id)
  AND (e.from_node = sqlc.arg(node_id)::text OR e.to_node = sqlc.arg(node_id)::text)
  -- No at = the database's now(), so an edge the DB just dated is never in the
  -- future of a client clock that runs behind it.
  AND e.valid_from <= COALESCE(sqlc.narg(at)::timestamptz, now())
  AND (e.valid_to IS NULL OR e.valid_to > COALESCE(sqlc.narg(at)::timestamptz, now()))
  AND (cardinality(sqlc.arg(edge_types)::text[]) = 0 OR e.edge_type = ANY(sqlc.arg(edge_types)::text[]))
  AND (sqlc.arg(direction)::text = 'both' OR (sqlc.arg(direction)::text = 'out') = (e.from_node = sqlc.arg(node_id)::text))
  AND p.organization_id = sqlc.arg(organization_id) AND p.deleted_at IS NULL
  AND (p.visibility = 'organization'
       OR (p.visibility = 'workspace' AND p.workspace_id = ANY(sqlc.arg(workspace_ids)::text[]))
       OR (p.visibility IN ('members', 'private') AND p.reader_ids @> ARRAY[sqlc.arg(user_id)::text]))
  AND (sqlc.narg(after_valid_from)::timestamptz IS NULL
       OR (e.valid_from, e.id) < (sqlc.narg(after_valid_from)::timestamptz, sqlc.arg(after_id)::text))
ORDER BY e.valid_from DESC, e.id DESC
LIMIT sqlc.arg(limit_n)::int;

-- name: GraphListNodeHistoryEdges :many
SELECT e.id AS edge_id, e.edge_type, e.origin, e.valid_from, e.valid_to, e.attrs,
       (e.from_node = sqlc.arg(node_id)::text) AS outgoing,
       p.node_type AS peer_type, p.subtype AS peer_subtype, p.source_id AS peer_source_id,
       p.title AS peer_title, p.status AS peer_status, (p.deleted_at IS NOT NULL)::boolean AS peer_deleted,
       COALESCE(p.workspace_id, '')::text AS peer_workspace_id, COALESCE(w.slug, '')::text AS peer_workspace_slug
FROM graph_edges e
JOIN graph_nodes p ON p.id = CASE WHEN e.from_node = sqlc.arg(node_id)::text THEN e.to_node ELSE e.from_node END
LEFT JOIN workspaces w ON w.id = p.workspace_id
WHERE e.organization_id = sqlc.arg(organization_id)
  AND (e.from_node = sqlc.arg(node_id)::text OR e.to_node = sqlc.arg(node_id)::text)
  AND e.edge_type = ANY(sqlc.arg(edge_types)::text[])
  AND (p.deleted_at IS NULL OR p.node_type IN ('ACTOR', 'TEAM'))
  AND (p.visibility = 'organization'
       OR (p.visibility = 'workspace' AND p.workspace_id = ANY(sqlc.arg(workspace_ids)::text[]))
       OR (p.visibility IN ('members', 'private') AND p.reader_ids @> ARRAY[sqlc.arg(user_id)::text]))
  AND (sqlc.narg(from_at)::timestamptz IS NULL OR e.valid_to IS NULL OR e.valid_to >= sqlc.narg(from_at)::timestamptz)
  AND (sqlc.narg(to_at)::timestamptz IS NULL OR e.valid_from <= sqlc.narg(to_at)::timestamptz)
ORDER BY e.valid_from, e.id
LIMIT 500;

-- name: GraphListNodeHistoryFacts :many
SELECT * FROM graph_node_facts
WHERE organization_id = sqlc.arg(organization_id) AND node_id = sqlc.arg(node_id)
  AND (sqlc.narg(from_at)::timestamptz IS NULL OR valid_to IS NULL OR valid_to >= sqlc.narg(from_at)::timestamptz)
  AND (sqlc.narg(to_at)::timestamptz IS NULL OR valid_from <= sqlc.narg(to_at)::timestamptz)
ORDER BY valid_from, id
LIMIT 500;
