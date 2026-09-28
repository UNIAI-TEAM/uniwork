-- Document access (C-01 §4 + §13.4; UNI-676). The queries behind
-- DocumentService.effectiveLevel and its authorize helpers. Membership is
-- never read here: it is decided only by WorkspaceService.RequireMember /
-- OrganizationService.RequireMember / RequireAgentMember.

-- Authorize-by-id (the GetTask pattern): the id alone finds the row, then the
-- service decides visibility from the row's own organization/workspace pair.
-- The caller never learns anything about a row it cannot read.
-- name: GetDocumentByID :one
SELECT *
FROM documents
WHERE id = sqlc.arg(id);

-- The mutation gate: the row lock serializes every command on a document
-- with share grants/revokes (which take the same lock), so the access
-- decision inside a mutation transaction always sees the committed ACL.
-- name: LockDocumentByID :one
SELECT *
FROM documents
WHERE id = sqlc.arg(id)
FOR UPDATE;

-- The blob pointer of a file document (documents.file_version_id) resolved
-- inside the document's tenant pair.
-- name: GetDocumentVersionByID :one
SELECT *
FROM document_versions
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id);

-- ---- Shares (G1-02b) ------------------------------------------------------

-- name: GetLiveDocumentShareByID :one
SELECT *
FROM document_shares
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND revoked_at IS NULL;

-- "Shared with me" candidates: live shares naming the person, the whole
-- organization, or one of the workspaces the service passes in (the ones the
-- person reaches through WorkspaceService; membership is never read in SQL).
-- The workspace filter runs before the limit so shares to workspaces the
-- person is not in cannot crowd theirs out; newest share first, id ascending
-- as the tiebreak, and (after_created_at, after_id) is the keyset that
-- continues the walk. The service still runs effectiveLevel on every row.
-- name: ListDocumentShareCandidates :many
SELECT sqlc.embed(d), c.created_at
FROM (
  SELECT DISTINCT ON (s.document_id) s.document_id, s.workspace_id, s.created_at
  FROM document_shares s
  WHERE s.organization_id = sqlc.arg(organization_id)
    AND s.revoked_at IS NULL
    AND (
      (s.principal_type = 'user' AND s.principal_id = sqlc.arg(user_id))
      OR (s.principal_type = 'organization' AND s.principal_id = sqlc.arg(organization_id))
      OR (s.principal_type = 'workspace' AND s.principal_id = ANY(sqlc.arg(workspace_ids)::text[]))
    )
  ORDER BY s.document_id, s.created_at DESC
) c
JOIN documents d
  ON d.organization_id = sqlc.arg(organization_id)
 AND d.workspace_id = c.workspace_id
 AND d.id = c.document_id
WHERE d.archived_at IS NULL
  AND d.owner_id IS NULL
  AND (
    sqlc.narg(after_created_at)::timestamptz IS NULL
    OR c.created_at < sqlc.narg(after_created_at)::timestamptz
    OR (c.created_at = sqlc.narg(after_created_at)::timestamptz AND d.id > sqlc.narg(after_id)::text)
  )
ORDER BY c.created_at DESC, d.id
LIMIT sqlc.arg(max_rows);

-- ---- Public links (G1-02b) -------------------------------------------------

-- name: InsertDocumentShareLink :one
INSERT INTO document_share_links (
  id, organization_id, workspace_id, document_id, token_hash, expires_at,
  created_by, created_by_kind
) VALUES (
  sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(workspace_id),
  sqlc.arg(document_id), sqlc.arg(token_hash), sqlc.arg(expires_at),
  sqlc.arg(created_by), sqlc.arg(created_by_kind)
)
RETURNING *;

-- Links that still open: not revoked and not expired.
-- name: ListLiveDocumentShareLinks :many
SELECT *
FROM document_share_links
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND revoked_at IS NULL
  AND expires_at > now()
ORDER BY created_at, id;

-- name: CountLiveDocumentShareLinks :one
SELECT count(*)
FROM document_share_links
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND revoked_at IS NULL
  AND expires_at > now();

-- name: GetDocumentShareLink :one
SELECT *
FROM document_share_links
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id);

-- name: RevokeDocumentShareLink :execrows
UPDATE document_share_links
SET revoked_at = now(), revoked_by = sqlc.arg(revoked_by)
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND revoked_at IS NULL;

-- The anonymous entry point: the token hash alone finds the link (the
-- token is the credential), and only a live one answers.
-- name: GetLiveDocumentShareLinkByTokenHash :one
SELECT *
FROM document_share_links
WHERE token_hash = sqlc.arg(token_hash)
  AND revoked_at IS NULL
  AND expires_at > now();

-- A public page view: counted only while the link is still live, so a
-- revoke that commits between lookup and count still refuses the read.
-- name: CountDocumentShareLinkView :one
UPDATE document_share_links
SET view_count = view_count + 1, last_viewed_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND revoked_at IS NULL
  AND expires_at > now()
RETURNING *;

-- ---- Organization settings (G1-02b) ----------------------------------------

-- name: GetDocumentSettings :one
SELECT *
FROM document_settings
WHERE organization_id = sqlc.arg(organization_id);

-- name: UpsertDocumentSettings :one
INSERT INTO document_settings (organization_id, public_links_enabled, updated_by, updated_by_kind)
VALUES (sqlc.arg(organization_id), sqlc.arg(public_links_enabled), sqlc.arg(updated_by), sqlc.arg(updated_by_kind))
ON CONFLICT (organization_id) DO UPDATE
SET public_links_enabled = EXCLUDED.public_links_enabled,
    updated_by = EXCLUDED.updated_by,
    updated_by_kind = EXCLUDED.updated_by_kind,
    updated_at = now()
RETURNING *;

-- ---- Access log (G1-02b) -----------------------------------------------------

-- name: InsertDocumentAccessLog :exec
INSERT INTO document_access_logs (
  id, organization_id, workspace_id, document_id, version, action,
  actor_kind, actor_id, via, share_link_id, correlation_id
) VALUES (
  sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(workspace_id),
  sqlc.arg(document_id), sqlc.arg(version), sqlc.arg(action),
  sqlc.arg(actor_kind), sqlc.arg(actor_id), sqlc.arg(via),
  sqlc.arg(share_link_id), sqlc.arg(correlation_id)
);

-- C-01 §3.6 coalescing: the same (document, actor, action) - and link, for
-- anonymous views - inside the window writes no new row.
-- name: DocumentAccessLoggedSince :one
SELECT EXISTS (
  SELECT 1
  FROM document_access_logs
  WHERE organization_id = sqlc.arg(organization_id)
    AND workspace_id = sqlc.arg(workspace_id)
    AND document_id = sqlc.arg(document_id)
    AND action = sqlc.arg(action)
    AND actor_kind = sqlc.arg(actor_kind)
    AND actor_id IS NOT DISTINCT FROM sqlc.narg(actor_id)
    AND share_link_id IS NOT DISTINCT FROM sqlc.narg(share_link_id)
    AND occurred_at > sqlc.arg(since)
);

-- name: ListDocumentAccessLogs :many
-- Newest first, id descending as the tiebreak; (before, before_id) is the
-- keyset of the last row read, so equal timestamps cannot skip a row. A
-- caller that passes only before keeps the historical strict-inequality
-- behavior (rows at exactly that timestamp are excluded).
SELECT *
FROM document_access_logs
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND (sqlc.narg(action)::text IS NULL OR action = sqlc.narg(action))
  AND (
    sqlc.narg(before)::timestamptz IS NULL
    OR occurred_at < sqlc.narg(before)::timestamptz
    OR (occurred_at = sqlc.narg(before)::timestamptz AND id < sqlc.narg(before_id)::text)
  )
ORDER BY occurred_at DESC, id DESC
LIMIT sqlc.arg(max_rows);
