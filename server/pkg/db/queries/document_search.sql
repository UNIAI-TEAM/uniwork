-- Document listing/search (C-01 §5.1, §6.3; G1-04b, UNI-678). The list
-- predicates push the authorization check into SQL so the permission filter
-- runs BEFORE the limit - no fetch-50-filter-to-2 pagination. Every query
-- carries the tenant pair and excludes owner-service documents
-- (d.owner_id IS NULL): owned search belongs to the owner service.
--
-- The shared permission predicate, inlined in each query, mirrors
-- DocumentService.resolveLevel:
--   ws_member + (ws admin | acl_owner)  -> manage  (passed as see_all)
--   ws_member + visibility='workspace'  -> member_visible at the row's
--     workspace_level, and only while that level is in share_levels (the
--     minimum the caller asks for; min=view matches every home row)
--   a live document_shares row at >= min_level reaching the actor: user
--     principal, a workspace principal the actor is a member of, or an
--     organization principal on the document's org
-- Share links are anonymous view tokens (document_links.go) and never grant
-- a member listing visibility. Restricted docs never match member_visible,
-- so an invisible document drops out of the set before LIMIT runs.
--
-- DOC-05 (UNI-1628): a see_all caller (workspace owner/admin) still lists a
-- restricted document they reach only through see_all - not the ACL owner, no
-- live share, no live break-glass grant - but cannot read it: such a row has
-- an empty snippet and a query matches its title only, never search_text, so
-- neither the snippet nor a body-only keyword leaks the content. The
-- "content readable" predicate is inlined where it is used.
-- acl_owner_id is NULL for agent/system-created documents: every ACL-owner leg of
-- that predicate carries IS NOT NULL, or the comparison is NULL, NOT NULL stays
-- NULL and the snippet CASE falls through to the body (same trap as
-- document_tree.sql ListDocumentSubtreeNeedingAccessCheck).
--
-- Actor-kind guards (resolveLevel answers the same): agents are never share
-- principals and never ACL owners, so callers pass allow_shares / acl_owner
-- false for an agent and every share or ACL-owner leg folds shut.

-- Flat "all" page and folded-text search share one cursor: (updated_at, id)
-- descending. q is already folded by the caller and escaped for LIKE.
-- name: ListDocumentsPage :many
SELECT d.*,
       COALESCE(CASE WHEN sqlc.narg(query)::text IS NULL THEN NULL::text
                     WHEN NOT (NOT sqlc.arg(see_all)::boolean
                 OR d.visibility <> 'restricted'
                 OR (d.acl_owner_id IS NOT NULL AND d.acl_owner_id = sqlc.arg(actor_id))
                 OR EXISTS (
                      SELECT 1 FROM document_shares rs
                      WHERE rs.organization_id = d.organization_id
                        AND rs.workspace_id = d.workspace_id
                        AND rs.document_id = d.id
                        AND rs.revoked_at IS NULL
                        AND ((rs.principal_type = 'user' AND rs.principal_id = sqlc.arg(actor_id))
                             OR (rs.principal_type = 'organization' AND rs.principal_id = d.organization_id)
                             OR (rs.principal_type = 'workspace'
                                 AND rs.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))
                 OR EXISTS (
                      SELECT 1 FROM document_break_glass_grants g
                      WHERE g.organization_id = d.organization_id
                        AND g.workspace_id = d.workspace_id
                        AND g.document_id = d.id
                        AND g.actor_id = sqlc.arg(actor_id)
                        AND g.actor_kind = 'human'
                        AND g.revoked_at IS NULL
                        AND g.expires_at > now())) THEN NULL::text
                     ELSE left(d.content_text, 160)::text END, '')::text AS snippet
FROM documents d
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.owner_id IS NULL
  AND d.archived_at IS NULL
  AND (sqlc.arg(see_all)
       OR (sqlc.arg(member_visible) AND d.visibility = 'workspace'
           AND d.workspace_level = ANY(sqlc.arg(share_levels)::text[]))
       OR (sqlc.arg(acl_owner) AND d.acl_owner_id = sqlc.arg(actor_id))
       OR (sqlc.arg(allow_shares) AND EXISTS (
            SELECT 1 FROM document_shares s
            WHERE s.organization_id = d.organization_id
              AND s.workspace_id = d.workspace_id
              AND s.document_id = d.id
              AND s.revoked_at IS NULL
              AND s.level = ANY(sqlc.arg(share_levels)::text[])
              AND ((s.principal_type = 'user' AND s.principal_id = sqlc.arg(actor_id))
                   OR (s.principal_type = 'organization' AND s.principal_id = d.organization_id)
                   OR (s.principal_type = 'workspace'
                       AND s.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))))
  AND (sqlc.narg(kind)::text IS NULL OR d.kind = sqlc.narg(kind))
  AND (sqlc.narg(exclude_kind)::text IS NULL OR d.kind <> sqlc.narg(exclude_kind))
  AND (sqlc.narg(updated_by)::text IS NULL OR d.updated_by = sqlc.narg(updated_by))
  AND (sqlc.narg(updated_from)::timestamptz IS NULL OR d.updated_at >= sqlc.narg(updated_from))
  AND (sqlc.narg(updated_to)::timestamptz IS NULL OR d.updated_at < sqlc.narg(updated_to))
  AND (sqlc.narg(query)::text IS NULL
       OR (NOT sqlc.arg(match_title)::boolean
           AND (NOT sqlc.arg(see_all)::boolean
                 OR d.visibility <> 'restricted'
                 OR (d.acl_owner_id IS NOT NULL AND d.acl_owner_id = sqlc.arg(actor_id))
                 OR EXISTS (
                      SELECT 1 FROM document_shares rs
                      WHERE rs.organization_id = d.organization_id
                        AND rs.workspace_id = d.workspace_id
                        AND rs.document_id = d.id
                        AND rs.revoked_at IS NULL
                        AND ((rs.principal_type = 'user' AND rs.principal_id = sqlc.arg(actor_id))
                             OR (rs.principal_type = 'organization' AND rs.principal_id = d.organization_id)
                             OR (rs.principal_type = 'workspace'
                                 AND rs.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))
                 OR EXISTS (
                      SELECT 1 FROM document_break_glass_grants g
                      WHERE g.organization_id = d.organization_id
                        AND g.workspace_id = d.workspace_id
                        AND g.document_id = d.id
                        AND g.actor_id = sqlc.arg(actor_id)
                        AND g.actor_kind = 'human'
                        AND g.revoked_at IS NULL
                        AND g.expires_at > now()))
           AND d.search_text ILIKE '%' || sqlc.narg(query)::text || '%' ESCAPE '\')
       OR ((sqlc.arg(match_title)::boolean OR NOT (NOT sqlc.arg(see_all)::boolean
                 OR d.visibility <> 'restricted'
                 OR (d.acl_owner_id IS NOT NULL AND d.acl_owner_id = sqlc.arg(actor_id))
                 OR EXISTS (
                      SELECT 1 FROM document_shares rs
                      WHERE rs.organization_id = d.organization_id
                        AND rs.workspace_id = d.workspace_id
                        AND rs.document_id = d.id
                        AND rs.revoked_at IS NULL
                        AND ((rs.principal_type = 'user' AND rs.principal_id = sqlc.arg(actor_id))
                             OR (rs.principal_type = 'organization' AND rs.principal_id = d.organization_id)
                             OR (rs.principal_type = 'workspace'
                                 AND rs.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))
                 OR EXISTS (
                      SELECT 1 FROM document_break_glass_grants g
                      WHERE g.organization_id = d.organization_id
                        AND g.workspace_id = d.workspace_id
                        AND g.document_id = d.id
                        AND g.actor_id = sqlc.arg(actor_id)
                        AND g.actor_kind = 'human'
                        AND g.revoked_at IS NULL
                        AND g.expires_at > now())))
           AND uw_fold_search(d.title) ILIKE '%' || sqlc.narg(query)::text || '%' ESCAPE '\'))
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
       OR (sqlc.arg(member_visible) AND d.visibility = 'workspace'
           AND d.workspace_level = ANY(sqlc.arg(share_levels)::text[]))
       OR (sqlc.arg(acl_owner) AND d.acl_owner_id = sqlc.arg(actor_id))
       OR (sqlc.arg(allow_shares) AND EXISTS (
            SELECT 1 FROM document_shares s
            WHERE s.organization_id = d.organization_id
              AND s.workspace_id = d.workspace_id
              AND s.document_id = d.id
              AND s.revoked_at IS NULL
              AND s.level = ANY(sqlc.arg(share_levels)::text[])
              AND ((s.principal_type = 'user' AND s.principal_id = sqlc.arg(actor_id))
                   OR (s.principal_type = 'organization' AND s.principal_id = d.organization_id)
                   OR (s.principal_type = 'workspace'
                       AND s.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))))
  AND (sqlc.narg(kind)::text IS NULL OR d.kind = sqlc.narg(kind))
  AND (sqlc.narg(exclude_kind)::text IS NULL OR d.kind <> sqlc.narg(exclude_kind))
  AND (sqlc.narg(updated_by)::text IS NULL OR d.updated_by = sqlc.narg(updated_by))
  AND (sqlc.narg(updated_from)::timestamptz IS NULL OR d.updated_at >= sqlc.narg(updated_from))
  AND (sqlc.narg(updated_to)::timestamptz IS NULL OR d.updated_at < sqlc.narg(updated_to))
  AND (sqlc.narg(query)::text IS NULL
       OR (NOT sqlc.arg(match_title)::boolean
           AND (NOT sqlc.arg(see_all)::boolean
                 OR d.visibility <> 'restricted'
                 OR (d.acl_owner_id IS NOT NULL AND d.acl_owner_id = sqlc.arg(actor_id))
                 OR EXISTS (
                      SELECT 1 FROM document_shares rs
                      WHERE rs.organization_id = d.organization_id
                        AND rs.workspace_id = d.workspace_id
                        AND rs.document_id = d.id
                        AND rs.revoked_at IS NULL
                        AND ((rs.principal_type = 'user' AND rs.principal_id = sqlc.arg(actor_id))
                             OR (rs.principal_type = 'organization' AND rs.principal_id = d.organization_id)
                             OR (rs.principal_type = 'workspace'
                                 AND rs.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))
                 OR EXISTS (
                      SELECT 1 FROM document_break_glass_grants g
                      WHERE g.organization_id = d.organization_id
                        AND g.workspace_id = d.workspace_id
                        AND g.document_id = d.id
                        AND g.actor_id = sqlc.arg(actor_id)
                        AND g.actor_kind = 'human'
                        AND g.revoked_at IS NULL
                        AND g.expires_at > now()))
           AND d.search_text ILIKE '%' || sqlc.narg(query)::text || '%' ESCAPE '\')
       OR ((sqlc.arg(match_title)::boolean OR NOT (NOT sqlc.arg(see_all)::boolean
                 OR d.visibility <> 'restricted'
                 OR (d.acl_owner_id IS NOT NULL AND d.acl_owner_id = sqlc.arg(actor_id))
                 OR EXISTS (
                      SELECT 1 FROM document_shares rs
                      WHERE rs.organization_id = d.organization_id
                        AND rs.workspace_id = d.workspace_id
                        AND rs.document_id = d.id
                        AND rs.revoked_at IS NULL
                        AND ((rs.principal_type = 'user' AND rs.principal_id = sqlc.arg(actor_id))
                             OR (rs.principal_type = 'organization' AND rs.principal_id = d.organization_id)
                             OR (rs.principal_type = 'workspace'
                                 AND rs.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))
                 OR EXISTS (
                      SELECT 1 FROM document_break_glass_grants g
                      WHERE g.organization_id = d.organization_id
                        AND g.workspace_id = d.workspace_id
                        AND g.document_id = d.id
                        AND g.actor_id = sqlc.arg(actor_id)
                        AND g.actor_kind = 'human'
                        AND g.revoked_at IS NULL
                        AND g.expires_at > now())))
           AND uw_fold_search(d.title) ILIKE '%' || sqlc.narg(query)::text || '%' ESCAPE '\'))
  AND (sqlc.narg(cursor_position)::float8 IS NULL
       OR (d.position, d.id) > (sqlc.narg(cursor_position), sqlc.narg(cursor_id)::text))
ORDER BY d.position, d.id
LIMIT sqlc.arg(page_limit);

-- The trash view: manage-only (workspace admin, the ACL owner, or a manage
-- share), ordered by archive time descending.
-- name: ListArchivedDocumentsPage :many
SELECT d.*
FROM documents d
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.owner_id IS NULL
  AND d.archived_at IS NOT NULL
  AND (sqlc.arg(see_all)
       OR (sqlc.arg(acl_owner) AND d.acl_owner_id = sqlc.arg(actor_id))
       OR (sqlc.arg(allow_shares) AND EXISTS (
            SELECT 1 FROM document_shares s
            WHERE s.organization_id = d.organization_id
              AND s.workspace_id = d.workspace_id
              AND s.document_id = d.id
              AND s.revoked_at IS NULL
              AND s.level = 'manage'
              AND ((s.principal_type = 'user' AND s.principal_id = sqlc.arg(actor_id))
                   OR (s.principal_type = 'organization' AND s.principal_id = d.organization_id)
                   OR (s.principal_type = 'workspace'
                       AND s.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))))
  AND (sqlc.narg(kind)::text IS NULL OR d.kind = sqlc.narg(kind))
  AND (sqlc.narg(exclude_kind)::text IS NULL OR d.kind <> sqlc.narg(exclude_kind))
  AND (sqlc.narg(updated_by)::text IS NULL OR d.updated_by = sqlc.narg(updated_by))
  AND (sqlc.narg(updated_from)::timestamptz IS NULL OR d.archived_at >= sqlc.narg(updated_from))
  AND (sqlc.narg(updated_to)::timestamptz IS NULL OR d.archived_at < sqlc.narg(updated_to))
  AND (sqlc.narg(query)::text IS NULL
       OR (NOT sqlc.arg(match_title)::boolean
           AND (NOT sqlc.arg(see_all)::boolean
                 OR d.visibility <> 'restricted'
                 OR (d.acl_owner_id IS NOT NULL AND d.acl_owner_id = sqlc.arg(actor_id))
                 OR EXISTS (
                      SELECT 1 FROM document_shares rs
                      WHERE rs.organization_id = d.organization_id
                        AND rs.workspace_id = d.workspace_id
                        AND rs.document_id = d.id
                        AND rs.revoked_at IS NULL
                        AND ((rs.principal_type = 'user' AND rs.principal_id = sqlc.arg(actor_id))
                             OR (rs.principal_type = 'organization' AND rs.principal_id = d.organization_id)
                             OR (rs.principal_type = 'workspace'
                                 AND rs.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))
                 OR EXISTS (
                      SELECT 1 FROM document_break_glass_grants g
                      WHERE g.organization_id = d.organization_id
                        AND g.workspace_id = d.workspace_id
                        AND g.document_id = d.id
                        AND g.actor_id = sqlc.arg(actor_id)
                        AND g.actor_kind = 'human'
                        AND g.revoked_at IS NULL
                        AND g.expires_at > now()))
           AND d.search_text ILIKE '%' || sqlc.narg(query)::text || '%' ESCAPE '\')
       OR ((sqlc.arg(match_title)::boolean OR NOT (NOT sqlc.arg(see_all)::boolean
                 OR d.visibility <> 'restricted'
                 OR (d.acl_owner_id IS NOT NULL AND d.acl_owner_id = sqlc.arg(actor_id))
                 OR EXISTS (
                      SELECT 1 FROM document_shares rs
                      WHERE rs.organization_id = d.organization_id
                        AND rs.workspace_id = d.workspace_id
                        AND rs.document_id = d.id
                        AND rs.revoked_at IS NULL
                        AND ((rs.principal_type = 'user' AND rs.principal_id = sqlc.arg(actor_id))
                             OR (rs.principal_type = 'organization' AND rs.principal_id = d.organization_id)
                             OR (rs.principal_type = 'workspace'
                                 AND rs.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))
                 OR EXISTS (
                      SELECT 1 FROM document_break_glass_grants g
                      WHERE g.organization_id = d.organization_id
                        AND g.workspace_id = d.workspace_id
                        AND g.document_id = d.id
                        AND g.actor_id = sqlc.arg(actor_id)
                        AND g.actor_kind = 'human'
                        AND g.revoked_at IS NULL
                        AND g.expires_at > now())))
           AND uw_fold_search(d.title) ILIKE '%' || sqlc.narg(query)::text || '%' ESCAPE '\'))
  AND (sqlc.narg(cursor_at)::timestamptz IS NULL
       OR (d.archived_at, d.id) < (sqlc.narg(cursor_at), sqlc.narg(cursor_id)::text))
ORDER BY d.archived_at DESC, d.id DESC
LIMIT sqlc.arg(page_limit);

-- Ancestor chain for a page of list results (E6/FD-05, UNI-1465). Both the
-- anchor and the recursive step carry organization_id and workspace_id so a
-- foreign-tenant "poison" parent can never be joined; max_level caps the walk
-- at 2*maxDocumentDepth and visited guards against cycles.
-- name: ListDocumentAncestors :many
WITH RECURSIVE anc AS (
  SELECT d.id, d.parent_id, d.title, d.visibility, d.acl_owner_id, d.owner_kind, d.archived_at,
         d.workspace_level,
         1 AS lvl, ARRAY[d.id]::text[] AS visited
  FROM documents d
  WHERE d.organization_id = sqlc.arg(organization_id)
    AND d.workspace_id = sqlc.arg(workspace_id)
    AND d.id = ANY(sqlc.arg(ids)::text[])
  UNION ALL
  SELECT p.id, p.parent_id, p.title, p.visibility, p.acl_owner_id, p.owner_kind, p.archived_at,
         p.workspace_level,
         anc.lvl + 1, anc.visited || p.id
  FROM documents p
  JOIN anc ON p.id = anc.parent_id
  WHERE p.organization_id = sqlc.arg(organization_id)
    AND p.workspace_id = sqlc.arg(workspace_id)
    AND anc.lvl < sqlc.arg(max_level)::int
    AND NOT (p.id = ANY(anc.visited))
)
SELECT DISTINCT id, parent_id, title, visibility, acl_owner_id, owner_kind, archived_at, workspace_level
FROM anc;

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
       OR (sqlc.arg(member_visible) AND d.visibility = 'workspace'
           AND d.workspace_level = ANY(sqlc.arg(share_levels)::text[]))
       OR (sqlc.arg(acl_owner) AND d.acl_owner_id = sqlc.arg(actor_id))
       OR (sqlc.arg(allow_shares) AND EXISTS (
            SELECT 1 FROM document_shares s
            WHERE s.organization_id = d.organization_id
              AND s.workspace_id = d.workspace_id
              AND s.document_id = d.id
              AND s.revoked_at IS NULL
              AND ((s.principal_type = 'user' AND s.principal_id = sqlc.arg(actor_id))
                   OR (s.principal_type = 'organization' AND s.principal_id = d.organization_id)
                   OR (s.principal_type = 'workspace'
                       AND s.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))))
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
       OR (sqlc.arg(member_visible) AND d.visibility = 'workspace'
           AND d.workspace_level = ANY(sqlc.arg(share_levels)::text[]))
       OR (sqlc.arg(acl_owner) AND d.acl_owner_id = sqlc.arg(actor_id))
       OR (sqlc.arg(allow_shares) AND EXISTS (
            SELECT 1 FROM document_shares s
            WHERE s.organization_id = d.organization_id
              AND s.workspace_id = d.workspace_id
              AND s.document_id = d.id
              AND s.revoked_at IS NULL
              AND ((s.principal_type = 'user' AND s.principal_id = sqlc.arg(actor_id))
                   OR (s.principal_type = 'organization' AND s.principal_id = d.organization_id)
                   OR (s.principal_type = 'workspace'
                       AND s.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))))
  AND (sqlc.narg(cursor_at)::timestamptz IS NULL
       OR (d.updated_at, d.id) < (sqlc.narg(cursor_at), sqlc.narg(cursor_id)::text))
ORDER BY d.updated_at DESC, d.id DESC
LIMIT sqlc.arg(page_limit);
