-- Document access report (UNI-1643). Read-only. Candidates are the live,
-- non-owned documents of one workspace (or one folder subtree), walked by id
-- so pages never repeat a row; the service resolves the caller's level on a
-- page through the list mirror of the resolver before it lists anything.
-- The candidate reads name the columns a report uses: never d.*, which
-- would drag content, content_text and search_text through every page.

-- Candidates are read in one of three orders, named by sort_mode: changed
-- (access_changed_at), title (the vi-x-icu collation, as UNI-2038's lists) and
-- id (the export's historic order). Every order ends on id COLLATE "C", and
-- the keyset predicate is (key, id) in that order, so duplicate keys neither
-- skip nor repeat a row across pages.
-- name: ListDocumentAccessReportWorkspaceCandidates :many
WITH cand AS (
SELECT d.id, d.organization_id, d.workspace_id, d.parent_id, d.kind, d.system_kind, d.title, d.visibility,
  d.workspace_level, d.owner_kind, d.owner_id, d.acl_owner_id, d.archived_at, d.updated_at,
  chg.changed_at AS access_changed_at
FROM documents d
  -- UNI-2039 S1: the last time the document's access changed - the greatest of
  -- the document's creation and every share, public link and break-glass
  -- stamp (created, revoked or granted). Revoked rows count: a revoke is a change.
  -- Only the changed order and the page read it (UNI-2039 fx1, F1): the id
  -- order of the export, summary and principals skips the subplans, and the
  -- two index-only reads are served by the (organization_id, workspace_id,
  -- document_id) INCLUDE (created_at, revoked_at) indexes.
  LEFT JOIN LATERAL (
    SELECT CASE WHEN sqlc.arg(sort_mode)::text = 'id' THEN NULL ELSE GREATEST(
      d.created_at,
      (SELECT max(GREATEST(s.created_at, s.revoked_at)) FROM document_shares s
        WHERE s.organization_id = d.organization_id AND s.workspace_id = d.workspace_id AND s.document_id = d.id),
      (SELECT max(GREATEST(l.created_at, l.revoked_at)) FROM document_share_links l
        WHERE l.organization_id = d.organization_id AND l.workspace_id = d.workspace_id AND l.document_id = d.id),
      (SELECT max(g.granted_at) FROM document_break_glass_grants g
        WHERE g.organization_id = d.organization_id AND g.workspace_id = d.workspace_id AND g.document_id = d.id)
    ) END::timestamptz AS changed_at
  ) chg ON true
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.archived_at IS NULL
  AND d.owner_id IS NULL
  -- UNI-2039 fx1: the report lists documents, not containers. A folder (My Folder
  -- is one) is a scope the picker or folder_id names, never a row of the report.
  AND d.kind <> 'folder'
  AND d.system_kind IS NULL
  AND (sqlc.arg(visibility)::text = '' OR d.visibility = sqlc.arg(visibility)::text)
  -- MYFOLDER-01 (UNI-1891): drop a candidate the admin would reach only
  -- through see_all when it lives inside another member's My Folder. A row
  -- stays when the actor is the ACL owner, it is workspace-visible at
  -- share_levels, a live share covers them, or it is not in the foreign set
  -- (uw_my_folder_foreign_ids, migration 9991792289293597).
  AND (NOT sqlc.arg(see_all)::boolean
       OR d.acl_owner_id = sqlc.arg(actor_id)::text
       OR (d.visibility = 'workspace' AND d.workspace_level = ANY(sqlc.arg(share_levels)::text[]))
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
                       AND s.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))
       OR NOT EXISTS (
            SELECT 1 FROM uw_my_folder_foreign_ids(
              sqlc.arg(actor_id), sqlc.arg(organization_id), sqlc.arg(workspace_id), sqlc.arg(max_level)::int
            ) mfs WHERE mfs.document_id = d.id))
)
SELECT c.id, c.organization_id, c.workspace_id, c.parent_id, c.kind, c.system_kind, c.title, c.visibility,
  c.workspace_level, c.owner_kind, c.owner_id, c.acl_owner_id, c.archived_at, c.updated_at, c.access_changed_at
FROM cand c
WHERE (NOT sqlc.arg(has_after)::boolean OR CASE sqlc.arg(sort_mode)::text
    WHEN 'changed' THEN CASE WHEN sqlc.arg(descending)::boolean
      THEN (c.access_changed_at < sqlc.arg(after_changed)::timestamptz
            OR (c.access_changed_at = sqlc.arg(after_changed)::timestamptz AND c.id COLLATE "C" > sqlc.arg(after_id)::text COLLATE "C"))
      ELSE (c.access_changed_at > sqlc.arg(after_changed)::timestamptz
            OR (c.access_changed_at = sqlc.arg(after_changed)::timestamptz AND c.id COLLATE "C" > sqlc.arg(after_id)::text COLLATE "C")) END
    WHEN 'title' THEN CASE WHEN sqlc.arg(descending)::boolean
      THEN (c.title COLLATE "vi-x-icu" < sqlc.arg(after_title)::text COLLATE "vi-x-icu"
            OR (c.title COLLATE "vi-x-icu" = sqlc.arg(after_title)::text COLLATE "vi-x-icu" AND c.id COLLATE "C" > sqlc.arg(after_id)::text COLLATE "C"))
      ELSE (c.title COLLATE "vi-x-icu" > sqlc.arg(after_title)::text COLLATE "vi-x-icu"
            OR (c.title COLLATE "vi-x-icu" = sqlc.arg(after_title)::text COLLATE "vi-x-icu" AND c.id COLLATE "C" > sqlc.arg(after_id)::text COLLATE "C")) END
    ELSE c.id COLLATE "C" > sqlc.arg(after_id)::text COLLATE "C" END)
ORDER BY
  (CASE WHEN sqlc.arg(sort_mode)::text = 'changed' AND NOT sqlc.arg(descending)::boolean THEN c.access_changed_at END) ASC,
  (CASE WHEN sqlc.arg(sort_mode)::text = 'changed' AND sqlc.arg(descending)::boolean THEN c.access_changed_at END) DESC,
  (CASE WHEN sqlc.arg(sort_mode)::text = 'title' AND NOT sqlc.arg(descending)::boolean THEN c.title END) COLLATE "vi-x-icu" ASC,
  (CASE WHEN sqlc.arg(sort_mode)::text = 'title' AND sqlc.arg(descending)::boolean THEN c.title END) COLLATE "vi-x-icu" DESC,
  c.id COLLATE "C"
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
), cand AS (
SELECT d.id, d.organization_id, d.workspace_id, d.parent_id, d.kind, d.system_kind, d.title, d.visibility,
  d.workspace_level, d.owner_kind, d.owner_id, d.acl_owner_id, d.archived_at, d.updated_at,
  chg.changed_at AS access_changed_at
FROM sub
JOIN documents d ON d.id = sub.id
  -- UNI-2039 S1: the last time the document's access changed - the greatest of
  -- the document's creation and every share, public link and break-glass
  -- stamp (created, revoked or granted). Revoked rows count: a revoke is a change.
  -- Only the changed order and the page read it (UNI-2039 fx1, F1): the id
  -- order of the export, summary and principals skips the subplans, and the
  -- two index-only reads are served by the (organization_id, workspace_id,
  -- document_id) INCLUDE (created_at, revoked_at) indexes.
  LEFT JOIN LATERAL (
    SELECT CASE WHEN sqlc.arg(sort_mode)::text = 'id' THEN NULL ELSE GREATEST(
      d.created_at,
      (SELECT max(GREATEST(s.created_at, s.revoked_at)) FROM document_shares s
        WHERE s.organization_id = d.organization_id AND s.workspace_id = d.workspace_id AND s.document_id = d.id),
      (SELECT max(GREATEST(l.created_at, l.revoked_at)) FROM document_share_links l
        WHERE l.organization_id = d.organization_id AND l.workspace_id = d.workspace_id AND l.document_id = d.id),
      (SELECT max(g.granted_at) FROM document_break_glass_grants g
        WHERE g.organization_id = d.organization_id AND g.workspace_id = d.workspace_id AND g.document_id = d.id)
    ) END::timestamptz AS changed_at
  ) chg ON true
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.archived_at IS NULL
  AND d.owner_id IS NULL
  -- UNI-2039 fx1: the report lists documents, not containers. A folder (My Folder
  -- is one) is a scope the picker or folder_id names, never a row of the report.
  AND d.kind <> 'folder'
  AND d.system_kind IS NULL
  AND (sqlc.arg(visibility)::text = '' OR d.visibility = sqlc.arg(visibility)::text)
  -- MYFOLDER-01 (UNI-1891): drop a candidate the admin would reach only
  -- through see_all when it lives inside another member's My Folder. A row
  -- stays when the actor is the ACL owner, it is workspace-visible at
  -- share_levels, a live share covers them, or it is not in the foreign set
  -- (uw_my_folder_foreign_ids, migration 9991792289293597).
  AND (NOT sqlc.arg(see_all)::boolean
       OR d.acl_owner_id = sqlc.arg(actor_id)::text
       OR (d.visibility = 'workspace' AND d.workspace_level = ANY(sqlc.arg(share_levels)::text[]))
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
                       AND s.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))
       OR NOT EXISTS (
            SELECT 1 FROM uw_my_folder_foreign_ids(
              sqlc.arg(actor_id), sqlc.arg(organization_id), sqlc.arg(workspace_id), sqlc.arg(max_level)::int
            ) mfs WHERE mfs.document_id = d.id))
)
SELECT c.id, c.organization_id, c.workspace_id, c.parent_id, c.kind, c.system_kind, c.title, c.visibility,
  c.workspace_level, c.owner_kind, c.owner_id, c.acl_owner_id, c.archived_at, c.updated_at, c.access_changed_at
FROM cand c
WHERE (NOT sqlc.arg(has_after)::boolean OR CASE sqlc.arg(sort_mode)::text
    WHEN 'changed' THEN CASE WHEN sqlc.arg(descending)::boolean
      THEN (c.access_changed_at < sqlc.arg(after_changed)::timestamptz
            OR (c.access_changed_at = sqlc.arg(after_changed)::timestamptz AND c.id COLLATE "C" > sqlc.arg(after_id)::text COLLATE "C"))
      ELSE (c.access_changed_at > sqlc.arg(after_changed)::timestamptz
            OR (c.access_changed_at = sqlc.arg(after_changed)::timestamptz AND c.id COLLATE "C" > sqlc.arg(after_id)::text COLLATE "C")) END
    WHEN 'title' THEN CASE WHEN sqlc.arg(descending)::boolean
      THEN (c.title COLLATE "vi-x-icu" < sqlc.arg(after_title)::text COLLATE "vi-x-icu"
            OR (c.title COLLATE "vi-x-icu" = sqlc.arg(after_title)::text COLLATE "vi-x-icu" AND c.id COLLATE "C" > sqlc.arg(after_id)::text COLLATE "C"))
      ELSE (c.title COLLATE "vi-x-icu" > sqlc.arg(after_title)::text COLLATE "vi-x-icu"
            OR (c.title COLLATE "vi-x-icu" = sqlc.arg(after_title)::text COLLATE "vi-x-icu" AND c.id COLLATE "C" > sqlc.arg(after_id)::text COLLATE "C")) END
    ELSE c.id COLLATE "C" > sqlc.arg(after_id)::text COLLATE "C" END)
ORDER BY
  (CASE WHEN sqlc.arg(sort_mode)::text = 'changed' AND NOT sqlc.arg(descending)::boolean THEN c.access_changed_at END) ASC,
  (CASE WHEN sqlc.arg(sort_mode)::text = 'changed' AND sqlc.arg(descending)::boolean THEN c.access_changed_at END) DESC,
  (CASE WHEN sqlc.arg(sort_mode)::text = 'title' AND NOT sqlc.arg(descending)::boolean THEN c.title END) COLLATE "vi-x-icu" ASC,
  (CASE WHEN sqlc.arg(sort_mode)::text = 'title' AND sqlc.arg(descending)::boolean THEN c.title END) COLLATE "vi-x-icu" DESC,
  c.id COLLATE "C"
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
SELECT id, document_id, principal_type, principal_id, level, granted_by, granted_by_kind, origin, created_at
FROM document_shares
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = ANY(sqlc.arg(document_ids)::text[])
  AND revoked_at IS NULL
ORDER BY document_id, created_at, id;

-- Live public links of a page of documents: not revoked and not expired, as
-- ListLiveDocumentShareLinks counts them (UNI-2039 S2: one report row each;
-- live_link_count is their number). Never the token hash.
-- name: ListLiveDocumentShareLinksForReport :many
SELECT id, document_id, created_by, created_by_kind, created_at, expires_at
FROM document_share_links
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = ANY(sqlc.arg(document_ids)::text[])
  AND revoked_at IS NULL
  AND expires_at > now()
ORDER BY document_id, created_at, id;

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

-- MYFOLDER-01 (UNI-1891): is this document in another member's My Folder
-- subtree in this workspace? Used to refuse a folder-scoped report whose
-- root the admin would reach only through see_all.
-- name: DocumentInForeignMyFolder :one
SELECT EXISTS (
  SELECT 1
  FROM documents d
  WHERE d.organization_id = sqlc.arg(organization_id)
    AND d.workspace_id = sqlc.arg(workspace_id)
    AND d.id = sqlc.arg(document_id)
    AND EXISTS (
      SELECT 1 FROM uw_my_folder_foreign_ids(
        sqlc.arg(actor_id), sqlc.arg(organization_id), sqlc.arg(workspace_id), sqlc.arg(max_level)::int
      ) mfs WHERE mfs.document_id = d.id)
)::boolean AS in_set;

-- UNI-2039 S7: how many people a workspace principal stands for - the
-- workspace's rows whose person is still an active member of the
-- organization (a deactivated member keeps the row, not the access).
-- name: CountDocumentAccessReportWorkspaceMembers :many
SELECT wm.workspace_id, count(*)::int AS n
FROM workspace_members wm
JOIN organization_members om ON om.organization_id = wm.organization_id AND om.user_id = wm.user_id
WHERE wm.organization_id = sqlc.arg(organization_id)
  AND wm.workspace_id = ANY(sqlc.arg(workspace_ids)::text[])
  AND om.deactivated_at IS NULL
GROUP BY wm.workspace_id;

-- UNI-2039 fx1 (F2): the sort position of the cursor's anchor document. The
-- cursor carries the id only, so the title / change time of a candidate the
-- caller may not read never reaches the client; the keyset value is read here,
-- inside the tenant, from the one row the id names. No row = the anchor was
-- purged, archived or became a container: the service answers 400 and the
-- client restarts the list.
-- name: GetDocumentAccessReportAnchor :one
SELECT d.title,
  (SELECT GREATEST(
      d.created_at,
      (SELECT max(GREATEST(s.created_at, s.revoked_at)) FROM document_shares s
        WHERE s.organization_id = d.organization_id AND s.workspace_id = d.workspace_id AND s.document_id = d.id),
      (SELECT max(GREATEST(l.created_at, l.revoked_at)) FROM document_share_links l
        WHERE l.organization_id = d.organization_id AND l.workspace_id = d.workspace_id AND l.document_id = d.id),
      (SELECT max(g.granted_at) FROM document_break_glass_grants g
        WHERE g.organization_id = d.organization_id AND g.workspace_id = d.workspace_id AND g.document_id = d.id)
    ))::timestamptz AS access_changed_at
FROM documents d
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.id = sqlc.arg(id)
  AND d.archived_at IS NULL
  AND d.owner_id IS NULL
  AND d.kind <> 'folder'
  AND d.system_kind IS NULL;
