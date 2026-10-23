-- Share scope summary per document on a list page (SH-S3, UNI-1782;
-- addendum §6.4, §7). One aggregate read per page across workspaces of one
-- organization so list, recent, shared-with-me, folder children and search
-- rows never run a query per document.
-- name: ListDocumentShareScopes :many
SELECT
  d.id AS document_id,
  (
    d.visibility = 'workspace'
    OR COALESCE(BOOL_OR(s.principal_type = 'workspace' AND s.principal_id = d.workspace_id), false)
  )::boolean AS home_workspace,
  COUNT(s.id) FILTER (WHERE s.principal_type = 'user')::bigint AS users,
  COUNT(s.id) FILTER (WHERE s.principal_type = 'workspace' AND s.principal_id <> d.workspace_id)::bigint AS workspaces,
  COALESCE(BOOL_OR(s.principal_type = 'organization' AND s.principal_id = d.organization_id), false)::boolean AS organization,
  EXISTS (
    SELECT 1
    FROM document_share_links l
    WHERE l.organization_id = d.organization_id
      AND l.workspace_id = d.workspace_id
      AND l.document_id = d.id
      AND l.revoked_at IS NULL
      AND l.expires_at > now()
  )::boolean AS public_link
FROM documents d
LEFT JOIN document_shares s
  ON s.organization_id = d.organization_id
 AND s.workspace_id = d.workspace_id
 AND s.document_id = d.id
 AND s.revoked_at IS NULL
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.id = ANY(sqlc.arg(document_ids)::text[])
GROUP BY d.id, d.organization_id, d.workspace_id, d.visibility;
