-- Emergency view grants for workspace admins on restricted documents
-- (DOC-05; UNI-1628). The table and the two level-resolution reads
-- (GetLiveDocumentBreakGlassGrantForActor, ListLiveBreakGlassGrantsForDocuments)
-- live in document_shares.sql; these are the write path and the admin views.

-- name: InsertDocumentBreakGlassGrant :one
INSERT INTO document_break_glass_grants (
  id, organization_id, workspace_id, document_id, actor_id, actor_kind,
  level, reason, expires_at
) VALUES (
  sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(workspace_id),
  sqlc.arg(document_id), sqlc.arg(actor_id), sqlc.arg(actor_kind),
  sqlc.arg(level), sqlc.arg(reason), sqlc.arg(expires_at)
)
RETURNING *;

-- A grant by id on one document, live or not, so a revoke can tell "already
-- ended" (idempotent 200) from "not on this document" (404).
-- name: GetDocumentBreakGlassGrant :one
SELECT *
FROM document_break_glass_grants
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND id = sqlc.arg(id);

-- The live grants of a document for the access panel, newest first.
-- name: ListLiveDocumentBreakGlassGrants :many
SELECT *
FROM document_break_glass_grants
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND revoked_at IS NULL
  AND expires_at > now()
ORDER BY granted_at DESC, id DESC;

-- Ends a live grant now. Zero rows means it was already revoked or expired.
-- name: RevokeDocumentBreakGlassGrant :execrows
UPDATE document_break_glass_grants
SET revoked_at = now(), revoked_by = sqlc.arg(revoked_by)
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND revoked_at IS NULL;
