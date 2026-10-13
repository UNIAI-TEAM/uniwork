-- Mention candidates for one document (G8-06, UNI-1401): the people who hold
-- at least view on it today, read from the same rows the document level rule
-- reads - effective workspace members (a workspace_members row; every member
-- when the document is workspace-visible, only its owner/admin when it is
-- restricted), the organization owners/admins RequireMember folds into
-- workspace admins, the ACL owner, and the live shares on the document (user,
-- workspace and organization principals). A deactivated organization member
-- is out: both membership gates refuse them (F-03). The caller is authorized
-- by the service before this runs, so the query only lists; a document whose
-- access is delegated to an owning product never reaches it.
--
-- The search term arrives already folded (foldForSearch) and escaped, and is
-- matched against uw_fold_search of the display name and, only for a caller
-- who may list the workspace's members (see_members), of the email - so the
-- search can never confirm an address the response hides.

-- name: ListDocumentMentionCandidates :many
SELECT
  u.id AS user_id,
  u.display_name,
  u.email,
  u.avatar_url,
  u.avatar_file_id
FROM organization_members om
JOIN users u ON u.id = om.user_id
WHERE om.organization_id = sqlc.arg(organization_id)::text
  AND om.deactivated_at IS NULL
  AND (
    om.role IN ('owner', 'admin')
    OR u.id = sqlc.narg(acl_owner_id)::text
    OR EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = sqlc.arg(workspace_id)::text
        AND wm.user_id = u.id
        AND (wm.role IN ('owner', 'admin') OR sqlc.arg(workspace_visible)::boolean))
    OR EXISTS (
      SELECT 1 FROM document_shares ds
      WHERE ds.organization_id = sqlc.arg(organization_id)::text
        AND ds.workspace_id = sqlc.arg(workspace_id)::text
        AND ds.document_id = sqlc.arg(document_id)::text
        AND ds.revoked_at IS NULL
        AND (
          (ds.principal_type = 'user' AND ds.principal_id = u.id)
          OR (ds.principal_type = 'organization' AND ds.principal_id = ds.organization_id)
          OR (ds.principal_type = 'workspace'
              AND EXISTS (
                SELECT 1 FROM workspaces w
                WHERE w.id = ds.principal_id
                  AND w.organization_id = ds.organization_id)
              AND (om.role IN ('owner', 'admin')
                OR EXISTS (
                  SELECT 1 FROM workspace_members wm2
                  WHERE wm2.workspace_id = ds.principal_id
                    AND wm2.user_id = u.id)))))
  )
  AND (
    sqlc.narg(q)::text IS NULL
    OR uw_fold_search(u.display_name) LIKE '%' || sqlc.narg(q)::text || '%'
    OR (sqlc.arg(see_members)::boolean
        AND uw_fold_search(u.email) LIKE '%' || sqlc.narg(q)::text || '%')
  )
ORDER BY u.display_name, u.id
LIMIT sqlc.arg(row_limit)::int;

-- Mention candidates for an owned document (G8-06, UNI-1401; C-01 section
-- 13.4): an owned document's level comes from its owning product, so its
-- readers cannot be read from membership or shares here. The picker therefore
-- starts from the effective workspace members of the document's workspace -
-- a workspace_members row, or an organization owner/admin, whom RequireMember
-- folds into a workspace admin - and the service keeps only the ones the
-- owner resolver really grants (FilterDocumentReaders). A deactivated
-- organization member is out, like everywhere else. The caller is authorized
-- by the service before this runs.
--
-- The search term arrives already folded (foldForSearch) and escaped; the
-- email leg applies only for a caller who may list the workspace's members
-- (see_members), so the search can never confirm an address the response
-- hides.
-- name: ListOwnedDocumentMentionCandidates :many
SELECT
  u.id AS user_id,
  u.display_name,
  u.email,
  u.avatar_url,
  u.avatar_file_id
FROM organization_members om
JOIN users u ON u.id = om.user_id
WHERE om.organization_id = sqlc.arg(organization_id)::text
  AND om.deactivated_at IS NULL
  AND (
    om.role IN ('owner', 'admin')
    OR EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = sqlc.arg(workspace_id)::text
        AND wm.organization_id = sqlc.arg(organization_id)::text
        AND wm.user_id = u.id)
  )
  AND (
    sqlc.narg(q)::text IS NULL
    OR uw_fold_search(u.display_name) LIKE '%' || sqlc.narg(q)::text || '%'
    OR (sqlc.arg(see_members)::boolean
        AND uw_fold_search(u.email) LIKE '%' || sqlc.narg(q)::text || '%')
  )
ORDER BY u.display_name, u.id
LIMIT sqlc.arg(row_limit)::int;
