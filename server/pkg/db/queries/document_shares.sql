-- Document shares (C-01 §3.4; UNI-675). Basic CRUD for the share panel;
-- level evaluation and the "shared with me" listing land with G1-02. Revoke
-- stamps revoked_at/revoked_by - the row is also the history of the grant.

-- name: InsertDocumentShare :one
INSERT INTO document_shares (
  id, organization_id, workspace_id, document_id, principal_type,
  principal_id, level, granted_by, granted_by_kind
) VALUES (
  sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(workspace_id),
  sqlc.arg(document_id), sqlc.arg(principal_type),
  sqlc.arg(principal_id), sqlc.arg(level), sqlc.arg(granted_by),
  sqlc.arg(granted_by_kind)
)
RETURNING *;

-- name: ListDocumentShares :many
SELECT *
FROM document_shares
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND revoked_at IS NULL
ORDER BY created_at, id;

-- The live grants on a page of documents of one workspace, read once so a list
-- can resolve every row's level without a query per row. Only the columns
-- the level rule needs.
-- name: ListLiveSharesForDocuments :many
SELECT document_id, principal_type, principal_id, level
FROM document_shares
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = ANY(sqlc.arg(document_ids)::text[])
  AND revoked_at IS NULL;

-- The live grant for a principal on a document, used when re-granting.
-- name: GetDocumentShare :one
SELECT *
FROM document_shares
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND principal_type = sqlc.arg(principal_type)
  AND principal_id = sqlc.arg(principal_id)
  AND revoked_at IS NULL;

-- name: RevokeDocumentShare :exec
UPDATE document_shares
SET revoked_at = now(), revoked_by = sqlc.arg(revoked_by)
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND revoked_at IS NULL;

-- The caller's live emergency view grant on a document (DOC-05; UNI-1628).
-- name: GetLiveDocumentBreakGlassGrantForActor :one
SELECT *
FROM document_break_glass_grants
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND actor_id = sqlc.arg(actor_id)
  AND actor_kind = sqlc.arg(actor_kind)
  AND revoked_at IS NULL
  AND expires_at > now()
ORDER BY granted_at DESC, id DESC
LIMIT 1;

-- The caller's live emergency view grants on a page of documents of one
-- workspace, read once so a list can resolve every restricted row's level
-- without a query per row (DOC-05; UNI-1628).
-- name: ListLiveBreakGlassGrantsForDocuments :many
SELECT document_id, level
FROM document_break_glass_grants
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = ANY(sqlc.arg(document_ids)::text[])
  AND actor_id = sqlc.arg(actor_id)
  AND actor_kind = sqlc.arg(actor_kind)
  AND revoked_at IS NULL
  AND expires_at > now();

