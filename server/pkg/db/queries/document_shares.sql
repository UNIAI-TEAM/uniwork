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

-- Group preview counts for PUT /documents/{documentID}/access (SH-S2, UNI-1781,
-- D5): member_count and losing_count of one workspace or organization group
-- item in one SQL query without loading member names.
-- name: CountDocumentAccessPreviewGroup :one
SELECT
  count(*)::bigint AS member_count,
  count(*) FILTER (
    WHERE sqlc.arg(prev_group_rank)::int > 0
      AND sqlc.arg(after_group_rank)::int < sqlc.arg(prev_group_rank)::int
      AND NOT sqlc.arg(org_preserves)::boolean
      AND (sqlc.narg(acl_owner_id)::text IS NULL OR om.user_id <> sqlc.narg(acl_owner_id)::text)
      AND NOT (
        sqlc.arg(home_after_rank)::int > 0
        AND (om.role IN ('owner', 'admin')
          OR EXISTS (
            SELECT 1 FROM workspace_members hwm
            WHERE hwm.organization_id = om.organization_id
              AND hwm.workspace_id = sqlc.arg(home_workspace_id)::text
              AND hwm.user_id = om.user_id
              AND hwm.role IN ('owner', 'admin')))
      )
      AND NOT (
        sqlc.arg(home_after_rank)::int >= sqlc.arg(prev_group_rank)::int
        AND (om.role IN ('owner', 'admin')
          OR EXISTS (
            SELECT 1 FROM workspace_members hwm
            WHERE hwm.organization_id = om.organization_id
              AND hwm.workspace_id = sqlc.arg(home_workspace_id)::text
              AND hwm.user_id = om.user_id))
      )
      AND NOT (om.user_id = ANY(sqlc.arg(preserved_user_ids)::text[]))
      AND NOT EXISTS (
        SELECT 1 FROM workspace_members swm
        WHERE swm.organization_id = om.organization_id
          AND swm.user_id = om.user_id
          AND swm.workspace_id = ANY(sqlc.arg(preserved_ws_ids)::text[])
      )
      AND NOT (
        sqlc.arg(prev_group_rank)::int <= 1
        AND EXISTS (
          SELECT 1 FROM document_break_glass_grants bg
          WHERE bg.organization_id = om.organization_id
            AND bg.workspace_id = sqlc.arg(home_workspace_id)::text
            AND bg.document_id = sqlc.arg(document_id)::text
            AND bg.actor_id = om.user_id
            AND bg.actor_kind = 'human'
            AND bg.revoked_at IS NULL
            AND bg.expires_at > now()
        )
      )
  )::bigint AS losing_count
FROM organization_members om
WHERE om.organization_id = sqlc.arg(organization_id)::text
  AND om.deactivated_at IS NULL
  AND (
    sqlc.arg(principal_type)::text = 'organization'
    OR EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.organization_id = om.organization_id
        AND wm.workspace_id = sqlc.arg(principal_id)::text
        AND wm.user_id = om.user_id
    )
  );


