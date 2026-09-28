-- Document listing/search (C-01 §5.1, §6.3; G1-04b, UNI-678). The list
-- predicates push the authorization check into SQL so the permission filter
-- runs BEFORE the limit - no fetch-50-filter-to-2 pagination. Every query
-- carries the tenant pair and excludes owner-service documents
-- (d.owner_id IS NULL): owned search belongs to the owner service.
--
-- The shared permission predicate, inlined in each query, mirrors
-- DocumentService.resolveLevel:
--   ws_member + (ws admin | acl_owner)  -> manage  (passed as see_all)
--   ws_member + visibility='workspace'  -> member_visible
--   a live document_shares row at >= min_level reaching the actor: user
--     principal, a workspace principal the actor is a member of, or an
--     organization principal on the document's org
-- Share links are anonymous view tokens (document_links.go) and never grant
-- a member listing visibility. Restricted docs never match member_visible,
-- so an invisible document drops out of the set before LIMIT runs.

-- Flat "all" page and folded-text search share one cursor: (updated_at, id)
-- descending. q is already folded by the caller and escaped for LIKE.
-- name: ListDocumentsPage :many
SELECT d.*,
       COALESCE(CASE WHEN sqlc.narg(query)::text IS NULL THEN NULL::text
                     ELSE left(d.content_text, 160)::text END, '')::text AS snippet
FROM documents d
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.owner_id IS NULL
  AND d.archived_at IS NULL
  AND (sqlc.arg(see_all)
       OR (sqlc.arg(member_visible) AND d.visibility = 'workspace')
       OR (sqlc.arg(member_visible) AND d.acl_owner_id = sqlc.arg(actor_id))
       OR EXISTS (
            SELECT 1 FROM document_shares s
            WHERE s.organization_id = d.organization_id
              AND s.workspace_id = d.workspace_id
              AND s.document_id = d.id
              AND s.revoked_at IS NULL
              AND s.level = ANY(sqlc.arg(share_levels)::text[])
              AND ((s.principal_type = 'user' AND s.principal_id = sqlc.arg(actor_id))
                   OR (s.principal_type = 'organization' AND s.principal_id = d.organization_id)
                   OR (s.principal_type = 'workspace'
                       AND s.principal_id = ANY(sqlc.arg(share_workspaces)::text[])))))
  AND (sqlc.narg(kind)::text IS NULL OR d.kind = sqlc.narg(kind))
  AND (sqlc.narg(updated_by)::text IS NULL OR d.updated_by = sqlc.narg(updated_by))
  AND (sqlc.narg(updated_from)::timestamptz IS NULL OR d.updated_at >= sqlc.narg(updated_from))
  AND (sqlc.narg(updated_to)::timestamptz IS NULL OR d.updated_at < sqlc.narg(updated_to))
  AND (sqlc.narg(query)::text IS NULL
       OR d.search_text ILIKE '%' || sqlc.narg(query)::text || '%' ESCAPE '\')
  AND (sqlc.narg(cursor_at)::timestamptz IS NULL
       OR (d.updated_at, d.id) < (sqlc.narg(cursor_at), sqlc.narg(cursor_id)::text))
ORDER BY d.updated_at DESC, d.id DESC
LIMIT sqlc.arg(page_limit);

-- One level of the tree: children of a parent (NULL parent = roots), cursor
-- is (position, id) ascending.
-- name: ListDocumentsByParentPage :many
SELECT d.*
FROM documents d
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.owner_id IS NULL
  AND d.archived_at IS NULL
  AND d.parent_id IS NOT DISTINCT FROM sqlc.narg(parent_id)
  AND (sqlc.arg(see_all)
       OR (sqlc.arg(member_visible) AND d.visibility = 'workspace')
       OR (sqlc.arg(member_visible) AND d.acl_owner_id = sqlc.arg(actor_id))
       OR EXISTS (
            SELECT 1 FROM document_shares s
            WHERE s.organization_id = d.organization_id
              AND s.workspace_id = d.workspace_id
              AND s.document_id = d.id
              AND s.revoked_at IS NULL
              AND s.level = ANY(sqlc.arg(share_levels)::text[])
              AND ((s.principal_type = 'user' AND s.principal_id = sqlc.arg(actor_id))
                   OR (s.principal_type = 'organization' AND s.principal_id = d.organization_id)
                   OR (s.principal_type = 'workspace'
                       AND s.principal_id = ANY(sqlc.arg(share_workspaces)::text[])))))
  AND (sqlc.narg(kind)::text IS NULL OR d.kind = sqlc.narg(kind))
  AND (sqlc.narg(updated_by)::text IS NULL OR d.updated_by = sqlc.narg(updated_by))
  AND (sqlc.narg(updated_from)::timestamptz IS NULL OR d.updated_at >= sqlc.narg(updated_from))
  AND (sqlc.narg(updated_to)::timestamptz IS NULL OR d.updated_at < sqlc.narg(updated_to))
  AND (sqlc.narg(query)::text IS NULL
       OR d.search_text ILIKE '%' || sqlc.narg(query)::text || '%' ESCAPE '\')
  AND (sqlc.narg(cursor_position)::float8 IS NULL
       OR (d.position, d.id) > (sqlc.narg(cursor_position), sqlc.narg(cursor_id)::text))
ORDER BY d.position, d.id
LIMIT sqlc.arg(page_limit);

-- The trash view: manage-only, ordered by archive time descending.
-- name: ListArchivedDocumentsPage :many
SELECT d.*
FROM documents d
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.owner_id IS NULL
  AND d.archived_at IS NOT NULL
  AND (sqlc.arg(see_all)
       OR EXISTS (
            SELECT 1 FROM document_shares s
            WHERE s.organization_id = d.organization_id
              AND s.workspace_id = d.workspace_id
              AND s.document_id = d.id
              AND s.revoked_at IS NULL
              AND s.level = 'manage'
              AND ((s.principal_type = 'user' AND s.principal_id = sqlc.arg(actor_id))
                   OR (s.principal_type = 'organization' AND s.principal_id = d.organization_id)
                   OR (s.principal_type = 'workspace'
                       AND s.principal_id = ANY(sqlc.arg(share_workspaces)::text[])))))
  AND (sqlc.narg(kind)::text IS NULL OR d.kind = sqlc.narg(kind))
  AND (sqlc.narg(updated_by)::text IS NULL OR d.updated_by = sqlc.narg(updated_by))
  AND (sqlc.narg(updated_from)::timestamptz IS NULL OR d.archived_at >= sqlc.narg(updated_from))
  AND (sqlc.narg(updated_to)::timestamptz IS NULL OR d.archived_at < sqlc.narg(updated_to))
  AND (sqlc.narg(query)::text IS NULL
       OR d.search_text ILIKE '%' || sqlc.narg(query)::text || '%' ESCAPE '\')
  AND (sqlc.narg(cursor_at)::timestamptz IS NULL
       OR (d.archived_at, d.id) < (sqlc.narg(cursor_at), sqlc.narg(cursor_id)::text))
ORDER BY d.archived_at DESC, d.id DESC
LIMIT sqlc.arg(page_limit);

-- Every visible live document of one workspace in tree order - the
-- DocumentTree endpoint assembles the forest in memory.
-- name: ListTreeDocuments :many
SELECT d.*
FROM documents d
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.owner_id IS NULL
  AND d.archived_at IS NULL
  AND (sqlc.arg(see_all)
       OR (sqlc.arg(member_visible) AND d.visibility = 'workspace')
       OR (sqlc.arg(member_visible) AND d.acl_owner_id = sqlc.arg(actor_id))
       OR EXISTS (
            SELECT 1 FROM document_shares s
            WHERE s.organization_id = d.organization_id
              AND s.workspace_id = d.workspace_id
              AND s.document_id = d.id
              AND s.revoked_at IS NULL
              AND ((s.principal_type = 'user' AND s.principal_id = sqlc.arg(actor_id))
                   OR (s.principal_type = 'organization' AND s.principal_id = d.organization_id)
                   OR (s.principal_type = 'workspace'
                       AND s.principal_id = ANY(sqlc.arg(share_workspaces)::text[])))))
ORDER BY d.position, d.id;

-- "Recent": documents the actor touched (access log) or last edited
-- (updated_by), permission-filtered, newest first.
-- name: ListRecentDocumentsPage :many
SELECT d.*
FROM documents d
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.owner_id IS NULL
  AND d.archived_at IS NULL
  AND (d.updated_by = sqlc.arg(actor_id)
       OR EXISTS (
            SELECT 1 FROM document_access_logs a
            WHERE a.organization_id = d.organization_id
              AND a.workspace_id = d.workspace_id
              AND a.document_id = d.id
              AND a.actor_id = sqlc.arg(actor_id)))
  AND (sqlc.arg(see_all)
       OR (sqlc.arg(member_visible) AND d.visibility = 'workspace')
       OR (sqlc.arg(member_visible) AND d.acl_owner_id = sqlc.arg(actor_id))
       OR EXISTS (
            SELECT 1 FROM document_shares s
            WHERE s.organization_id = d.organization_id
              AND s.workspace_id = d.workspace_id
              AND s.document_id = d.id
              AND s.revoked_at IS NULL
              AND ((s.principal_type = 'user' AND s.principal_id = sqlc.arg(actor_id))
                   OR (s.principal_type = 'organization' AND s.principal_id = d.organization_id)
                   OR (s.principal_type = 'workspace'
                       AND s.principal_id = ANY(sqlc.arg(share_workspaces)::text[])))))
  AND (sqlc.narg(cursor_at)::timestamptz IS NULL
       OR (d.updated_at, d.id) < (sqlc.narg(cursor_at), sqlc.narg(cursor_id)::text))
ORDER BY d.updated_at DESC, d.id DESC
LIMIT sqlc.arg(page_limit);
