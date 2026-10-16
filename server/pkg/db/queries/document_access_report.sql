-- Document access report (UNI-1643). Read-only. Candidates are the live,
-- non-owned documents of one workspace (or one folder subtree), walked by id
-- so pages never repeat a row; the service resolves the caller's level on a
-- page through the list mirror of the resolver before it lists anything.
-- The candidate reads name the columns a report uses: never d.*, which
-- would drag content, content_text and search_text through every page.

-- name: ListDocumentAccessReportWorkspaceCandidates :many
SELECT d.id, d.organization_id, d.workspace_id, d.parent_id, d.kind, d.title, d.visibility,
  d.workspace_level, d.owner_kind, d.owner_id, d.acl_owner_id, d.archived_at, d.updated_at
FROM documents d
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.archived_at IS NULL
  AND d.owner_id IS NULL
  AND (sqlc.arg(visibility)::text = '' OR d.visibility = sqlc.arg(visibility)::text)
  AND d.id > sqlc.arg(after_id)::text
ORDER BY d.id
LIMIT sqlc.arg(max_rows);

-- The folder subtree, root included, walked as ListLiveDocumentSubtreeIDs
-- does (archived nodes on the way are still walked so a live child of an
-- archived parent stays reachable; they are dropped from the candidates).
-- max_level is the corrupted-chain guard from subtreeMaxLevel.
-- name: ListDocumentAccessReportSubtreeCandidates :many
WITH RECURSIVE sub AS (
  SELECT r.id, 1 AS lvl
  FROM documents r
  WHERE r.organization_id = sqlc.arg(organization_id)
    AND r.workspace_id = sqlc.arg(workspace_id)
    AND r.id = sqlc.arg(root_id)
  UNION ALL
  SELECT c.id, sub.lvl + 1
  FROM documents c
  JOIN sub ON c.parent_id = sub.id
  WHERE c.organization_id = sqlc.arg(organization_id)
    AND c.workspace_id = sqlc.arg(workspace_id)
    AND sub.lvl < sqlc.arg(max_level)::int
)
SELECT d.id, d.organization_id, d.workspace_id, d.parent_id, d.kind, d.title, d.visibility,
  d.workspace_level, d.owner_kind, d.owner_id, d.acl_owner_id, d.archived_at, d.updated_at
FROM sub
JOIN documents d ON d.id = sub.id
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.archived_at IS NULL
  AND d.owner_id IS NULL
  AND (sqlc.arg(visibility)::text = '' OR d.visibility = sqlc.arg(visibility)::text)
  AND d.id > sqlc.arg(after_id)::text
ORDER BY d.id
LIMIT sqlc.arg(max_rows);

-- The number of nodes of the same walk, stopped at max_nodes + 1: the export
-- refuses a subtree over its cap before it reads a page.
-- name: CountDocumentAccessReportSubtree :one
WITH RECURSIVE sub AS (
  SELECT r.id, 1 AS lvl
  FROM documents r
  WHERE r.organization_id = sqlc.arg(organization_id)
    AND r.workspace_id = sqlc.arg(workspace_id)
    AND r.id = sqlc.arg(root_id)
  UNION ALL
  SELECT c.id, sub.lvl + 1
  FROM documents c
  JOIN sub ON c.parent_id = sub.id
  WHERE c.organization_id = sqlc.arg(organization_id)
    AND c.workspace_id = sqlc.arg(workspace_id)
    AND sub.lvl < sqlc.arg(max_level)::int
)
SELECT count(*)::int AS n
FROM (SELECT id FROM sub LIMIT sqlc.arg(max_nodes)::int + 1) capped;

-- The live grants of a page of documents with the columns a report row
-- shows. A separate query from ListLiveSharesForDocuments, which the hot
-- list path keeps narrow.
-- name: ListLiveDocumentSharesForReport :many
SELECT id, document_id, principal_type, principal_id, level, granted_by, granted_by_kind, created_at
FROM document_shares
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = ANY(sqlc.arg(document_ids)::text[])
  AND revoked_at IS NULL
ORDER BY document_id, created_at, id;

-- Live public links per document of a page: not revoked and not expired, as
-- ListLiveDocumentShareLinks counts them. Never the token hash.
-- name: CountLiveDocumentShareLinksForDocuments :many
SELECT document_id, count(*)::int AS n
FROM document_share_links
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = ANY(sqlc.arg(document_ids)::text[])
  AND revoked_at IS NULL
  AND expires_at > now()
GROUP BY document_id;

-- The live break-glass grants of a page of documents (UNI-1413 DOC-05):
-- every admin's, not only the caller's, as the report shows who holds
-- access. Live = not revoked and not expired, as resolveLevelInTenant reads
-- them. Never the reason: that stays on the share panel and the audit row.
-- name: ListLiveBreakGlassGrantsForReport :many
SELECT id, document_id, actor_id, actor_kind, level, granted_at
FROM document_break_glass_grants
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = ANY(sqlc.arg(document_ids)::text[])
  AND revoked_at IS NULL
  AND expires_at > now()
ORDER BY document_id, granted_at, id;
