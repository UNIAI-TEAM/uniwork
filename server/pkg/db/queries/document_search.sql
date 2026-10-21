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
                     ELSE left(d.content_text, 160)::text END, '')::text AS snippet,
       sk.name_key AS sort_name, sk.size_key AS sort_size,
       sk.editor_key AS sort_editor, sk.editor_null AS sort_editor_null,
       sk.ts_key AS sort_at, fav.created_at AS favorited_at
FROM documents d
-- UNI-1868: the current version of a file document, for the format filter and
-- the format each row reports. Joined on the document's own tenant pair and
-- the document itself, so a version of another tenant or document can never
-- answer for the row.
LEFT JOIN document_versions cv
  ON cv.organization_id = d.organization_id
 AND cv.workspace_id = d.workspace_id
 AND cv.document_id = d.id
 AND cv.id = d.file_version_id
-- UNI-2045 SV-2: with favorites_user set the list is that person's stars in
-- the workspace (the favorites route): the star joins on the tenant pair and the
-- document, and sort=starred orders by its created_at. Without it the join is
-- off and every row stays.
LEFT JOIN document_favorites fav
  ON sqlc.narg(favorites_user)::text IS NOT NULL
 AND fav.organization_id = d.organization_id
 AND fav.workspace_id = d.workspace_id
 AND fav.document_id = d.id
 AND fav.user_id = sqlc.narg(favorites_user)::text
-- UNI-2038 S3: the sort keys of a row, computed once. The name key is the
-- title itself under the Vietnamese ICU collation (Đ sorts after D, tones and
-- case variants stay together, whatever the database locale is); the size key is the current
-- file version's size (0 for a page or a folder); the editor key is the last
-- editor's display name (same collation), and only a human editor with a name has one - an
-- agent, a removed account or a blank name sets editor_null and sorts last. Each
-- key is computed only under its own sort (the others are constants), so an
-- unsorted list pays nothing for them and the users join runs for sort=editor.
-- UNI-2045 SV-4: the newest live grant of the row (a person, a workspace or a
-- link, as ListDocumentShareSummaries counts them), read only under
-- sort=shared; a row with none has a NULL key and sorts last.
LEFT JOIN LATERAL (
  SELECT max(gr.created_at) AS latest_at
  FROM (
    SELECT s.created_at FROM document_shares s
    WHERE sqlc.narg(sort_key)::text = 'shared'
      AND s.organization_id = d.organization_id
      AND s.workspace_id = d.workspace_id
      AND s.document_id = d.id
      AND s.revoked_at IS NULL
      AND s.principal_type IN ('user', 'workspace')
    UNION ALL
    SELECT l.created_at FROM document_share_links l
    WHERE sqlc.narg(sort_key)::text = 'shared'
      AND l.organization_id = d.organization_id
      AND l.workspace_id = d.workspace_id
      AND l.document_id = d.id
      AND l.revoked_at IS NULL
      AND l.expires_at > now()
  ) gr
) sh ON true
LEFT JOIN users eu
  ON eu.id = d.updated_by
 AND d.updated_by_kind = 'human'
 AND sqlc.narg(sort_key)::text = 'editor'
CROSS JOIN LATERAL (SELECT
    (CASE WHEN sqlc.narg(sort_key)::text = 'name' THEN d.title ELSE '' END COLLATE "vi-x-icu")::text AS name_key,
    (CASE WHEN sqlc.narg(sort_key)::text = 'size' THEN COALESCE(cv.size_bytes, 0) ELSE 0 END)::bigint AS size_key,
    (CASE WHEN sqlc.narg(sort_key)::text = 'editor' THEN COALESCE(eu.display_name COLLATE "vi-x-icu", '') ELSE '' END)::text AS editor_key,
    (CASE WHEN sqlc.narg(sort_key)::text = 'editor' THEN NULLIF(btrim(eu.display_name), '') IS NULL
         WHEN sqlc.narg(sort_key)::text = 'shared' THEN sh.latest_at IS NULL ELSE false END)::boolean AS editor_null,
    (CASE WHEN sqlc.narg(sort_key)::text = 'starred' THEN fav.created_at
         WHEN sqlc.narg(sort_key)::text = 'shared' THEN sh.latest_at ELSE d.updated_at END)::timestamptz AS ts_key
) sk
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.owner_id IS NULL
  AND d.archived_at IS NULL
  -- ARCHIVE-01 (Q-AR3 = a): shelved rows leave the flat list and rejoin it
  -- only under a search term (q), carrying shelved_at for the label.
  AND (sqlc.narg(query)::text IS NOT NULL OR d.shelved_at IS NULL)
  AND ((sqlc.arg(see_all)
        AND (d.system_kind IS NULL OR d.system_kind <> 'my_folder' OR d.acl_owner_id = sqlc.arg(actor_id))
        -- MYFOLDER-01 (UNI-1891): exclude a foreign My Folder row the see_all
        -- (admin) leg would otherwise add. The row stays when the actor is
        -- its ACL owner, it is workspace-visible at share_levels (what the
        -- member predicate would admit), or it is not in the foreign set; a
        -- live share is the OR below. Removes only what admin scope ADDS.
        -- Set: uw_my_folder_foreign_ids (migration 9991792289293597).
        AND (d.acl_owner_id = sqlc.arg(actor_id)
             OR (d.visibility = 'workspace' AND d.workspace_level = ANY(sqlc.arg(share_levels)::text[]))
             OR NOT EXISTS (
                  SELECT 1 FROM uw_my_folder_foreign_ids(
                    sqlc.arg(actor_id), sqlc.arg(organization_id), sqlc.arg(workspace_id), sqlc.arg(max_level)::int
                  ) mfs WHERE mfs.document_id = d.id)))
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
  AND (sqlc.narg(favorites_user)::text IS NULL OR fav.id IS NOT NULL)
  AND (sqlc.narg(kind)::text IS NULL OR d.kind = sqlc.narg(kind))
  AND (sqlc.narg(exclude_kind)::text IS NULL OR d.kind <> sqlc.narg(exclude_kind))
  AND (sqlc.narg(updated_by)::text IS NULL OR d.updated_by = sqlc.narg(updated_by))
  AND (sqlc.narg(updated_from)::timestamptz IS NULL OR d.updated_at >= sqlc.narg(updated_from))
  AND (sqlc.narg(updated_to)::timestamptz IS NULL OR d.updated_at < sqlc.narg(updated_to))
  -- UNI-1868 format filter: the file format of the row's current version. The
  -- MIME an upload verified wins; the title's extension answers only while the
  -- MIME names none of the six formats the library lists. Folders always stay
  -- (they are how one reaches files) and a page never matches.
  AND (sqlc.narg(format)::text IS NULL
       OR d.kind = 'folder'
       OR (d.kind = 'file'
           AND (cv.mime_type = sqlc.narg(format_mime)::text
                OR ((cv.mime_type IS NULL OR NOT (cv.mime_type = ANY(sqlc.arg(format_mimes)::text[])))
                    AND length(d.title) > length(sqlc.narg(format)::text) + 1
                    AND right(lower(d.title), length(sqlc.narg(format)::text) + 1) = '.' || sqlc.narg(format)::text))))
  -- UNI-1868 access filter: the same ladder the permission block above
  -- resolves, so it agrees with the my_level the row reports - role or ACL
  -- owner manage, the home row's workspace_level, a live share at a level in
  -- access_levels (manage; edit and manage). agent caps the home-row leg: an
  -- agent reads view whatever the row carries. 'restricted' is the row's
  -- visibility, the way the library's access filter has it.
  AND (sqlc.narg(access)::text IS NULL
       OR (sqlc.narg(access)::text = 'restricted' AND d.visibility = 'restricted')
       OR (sqlc.narg(access)::text <> 'restricted'
           AND ((sqlc.arg(see_all) AND NOT (d.visibility = 'restricted'
                                            AND NOT (d.acl_owner_id IS NOT NULL AND d.acl_owner_id = sqlc.arg(actor_id))))
                OR (sqlc.arg(acl_owner) AND d.acl_owner_id IS NOT NULL AND d.acl_owner_id = sqlc.arg(actor_id))
                OR (sqlc.arg(member_visible) AND NOT sqlc.arg(agent)::boolean
                    AND d.visibility = 'workspace'
                    AND d.workspace_level = ANY(sqlc.arg(access_levels)::text[]))
                OR (sqlc.arg(allow_shares) AND EXISTS (
                     SELECT 1 FROM document_shares a
                     WHERE a.organization_id = d.organization_id
                       AND a.workspace_id = d.workspace_id
                       AND a.document_id = d.id
                       AND a.revoked_at IS NULL
                       AND a.level = ANY(sqlc.arg(access_levels)::text[])
                       AND ((a.principal_type = 'user' AND a.principal_id = sqlc.arg(actor_id))
                            OR (a.principal_type = 'organization' AND a.principal_id = d.organization_id)
                            OR (a.principal_type = 'workspace' AND a.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))))))
  -- System rows (My Folder) are never "shared by me": they refuse shares and visibility changes.
  AND (NOT sqlc.arg(shared_by_me)::boolean OR d.system_kind IS NULL)
  AND (NOT sqlc.arg(shared_by_me)::boolean
       OR ((sqlc.arg(see_all)::boolean OR sqlc.arg(acl_owner)::boolean)
           AND d.acl_owner_id IS NOT NULL
           AND d.acl_owner_id = sqlc.arg(actor_id)
           AND (d.visibility = 'workspace'
                OR EXISTS (
                     SELECT 1 FROM document_shares sbm
                     WHERE sbm.organization_id = d.organization_id
                       AND sbm.workspace_id = d.workspace_id
                       AND sbm.document_id = d.id
                       AND sbm.revoked_at IS NULL
                       AND ((sbm.principal_type = 'user')
                            OR (sbm.principal_type = 'workspace')
                            OR (sbm.principal_type = 'organization' AND sbm.principal_id = d.organization_id))))
           -- UNI-1973: show only the topmost shared item. A row whose sharing is
           -- just the workspace visibility copied from its parent at create time
           -- (same level, no live share of its own) is hidden when that parent is
           -- a live non-folder row the caller owns, shared the same way (children of a
           -- folder always show: folders are not shareable, UNI-1974).
           AND NOT (d.visibility = 'workspace'
                    AND NOT EXISTS (
                         SELECT 1 FROM document_shares ow
                         WHERE ow.organization_id = d.organization_id
                           AND ow.workspace_id = d.workspace_id
                           AND ow.document_id = d.id
                           AND ow.revoked_at IS NULL)
                    AND EXISTS (
                         SELECT 1 FROM documents sp
                         WHERE sp.organization_id = d.organization_id
                           AND sp.workspace_id = d.workspace_id
                           AND sp.id = d.parent_id
                           AND sp.owner_id IS NULL
                           AND sp.archived_at IS NULL
                           AND sp.shelved_at IS NULL
                           AND sp.system_kind IS NULL
                           AND sp.kind <> 'folder'
                           AND sp.acl_owner_id = d.acl_owner_id
                           AND sp.visibility = 'workspace'
                           AND sp.workspace_level = d.workspace_level))))
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
  -- UNI-2038 S3 keyset of a sorted page: (key, id) past the cursor row in the
  -- requested direction; an editor-less row (editor_null) is always last.
  AND (sqlc.narg(sort_cursor_id)::text IS NULL OR CASE sqlc.narg(sort_key)::text
       WHEN 'updated' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (d.updated_at, d.id COLLATE "C") < (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (d.updated_at, d.id COLLATE "C") > (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
       WHEN 'starred' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.ts_key, d.id COLLATE "C") < (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.ts_key, d.id COLLATE "C") > (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
       WHEN 'shared' THEN (sk.editor_null::int > sqlc.narg(sort_cursor_null)::boolean::int
            OR (sk.editor_null = sqlc.narg(sort_cursor_null)::boolean
                AND CASE WHEN sk.editor_null THEN
                       CASE WHEN sqlc.arg(sort_desc)::boolean THEN d.id COLLATE "C" < sqlc.narg(sort_cursor_id)::text COLLATE "C"
                            ELSE d.id COLLATE "C" > sqlc.narg(sort_cursor_id)::text COLLATE "C" END
                     WHEN sqlc.arg(sort_desc)::boolean
                       THEN (sk.ts_key, d.id COLLATE "C") < (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C")
                     ELSE (sk.ts_key, d.id COLLATE "C") > (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C") END))
       WHEN 'size' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.size_key, d.id COLLATE "C") < (sqlc.narg(sort_cursor_num)::bigint, sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.size_key, d.id COLLATE "C") > (sqlc.narg(sort_cursor_num)::bigint, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
       WHEN 'name' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.name_key COLLATE "vi-x-icu", d.id COLLATE "C") < (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.name_key COLLATE "vi-x-icu", d.id COLLATE "C") > (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C") END
       WHEN 'editor' THEN (sk.editor_null::int > sqlc.narg(sort_cursor_null)::boolean::int
            OR (sk.editor_null = sqlc.narg(sort_cursor_null)::boolean
                AND CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.editor_key COLLATE "vi-x-icu", d.id COLLATE "C") < (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.editor_key COLLATE "vi-x-icu", d.id COLLATE "C") > (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C") END))
       ELSE true END)
-- UNI-2038 S3: no sort_key keeps the list's own order (the first two terms);
-- a sort_key orders by (key, id) in one direction. Every term is a CASE on a
-- bound parameter, so the planner folds the unused ones away and a plain
-- (key, id) order remains.
ORDER BY
  (CASE WHEN sqlc.narg(sort_key)::text IS NULL THEN d.updated_at END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text IS NULL THEN d.id END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text IN ('editor', 'shared') THEN sk.editor_null END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'name' AND NOT sqlc.arg(sort_desc)::boolean THEN sk.name_key
        WHEN sqlc.narg(sort_key)::text = 'editor' AND NOT sqlc.arg(sort_desc)::boolean THEN sk.editor_key END) COLLATE "vi-x-icu" ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'name' AND sqlc.arg(sort_desc)::boolean THEN sk.name_key
        WHEN sqlc.narg(sort_key)::text = 'editor' AND sqlc.arg(sort_desc)::boolean THEN sk.editor_key END) COLLATE "vi-x-icu" DESC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'size' AND NOT sqlc.arg(sort_desc)::boolean THEN sk.size_key END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'size' AND sqlc.arg(sort_desc)::boolean THEN sk.size_key END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'updated' AND NOT sqlc.arg(sort_desc)::boolean THEN d.updated_at END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'updated' AND sqlc.arg(sort_desc)::boolean THEN d.updated_at END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text IN ('starred', 'shared') AND NOT sqlc.arg(sort_desc)::boolean THEN sk.ts_key END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text IN ('starred', 'shared') AND sqlc.arg(sort_desc)::boolean THEN sk.ts_key END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text IS NOT NULL AND NOT sqlc.arg(sort_desc)::boolean THEN d.id COLLATE "C" END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text IS NOT NULL AND sqlc.arg(sort_desc)::boolean THEN d.id COLLATE "C" END) DESC
LIMIT sqlc.arg(page_limit);

-- One level of the tree: children of a parent (NULL parent = roots), cursor
-- is (position, id) ascending.
-- name: ListDocumentsByParentPage :many
SELECT sqlc.embed(d),
       sk.name_key AS sort_name, sk.size_key AS sort_size,
       sk.editor_key AS sort_editor, sk.editor_null AS sort_editor_null
FROM documents d
LEFT JOIN document_versions cv
  ON cv.organization_id = d.organization_id
 AND cv.workspace_id = d.workspace_id
 AND cv.document_id = d.id
 AND cv.id = d.file_version_id
-- UNI-2038 S3: the sort keys of a row, computed once. The name key is the
-- title itself under the Vietnamese ICU collation (Đ sorts after D, tones and
-- case variants stay together, whatever the database locale is); the size key is the current
-- file version's size (0 for a page or a folder); the editor key is the last
-- editor's display name (same collation), and only a human editor with a name has one - an
-- agent, a removed account or a blank name sets editor_null and sorts last. Each
-- key is computed only under its own sort (the others are constants), so an
-- unsorted list pays nothing for them and the users join runs for sort=editor.
LEFT JOIN users eu
  ON eu.id = d.updated_by
 AND d.updated_by_kind = 'human'
 AND sqlc.narg(sort_key)::text = 'editor'
CROSS JOIN LATERAL (SELECT
    (CASE WHEN sqlc.narg(sort_key)::text = 'name' THEN d.title ELSE '' END COLLATE "vi-x-icu")::text AS name_key,
    (CASE WHEN sqlc.narg(sort_key)::text = 'size' THEN COALESCE(cv.size_bytes, 0) ELSE 0 END)::bigint AS size_key,
    (CASE WHEN sqlc.narg(sort_key)::text = 'editor' THEN COALESCE(eu.display_name COLLATE "vi-x-icu", '') ELSE '' END)::text AS editor_key,
    (CASE WHEN sqlc.narg(sort_key)::text = 'editor' THEN NULLIF(btrim(eu.display_name), '') IS NULL ELSE false END)::boolean AS editor_null
) sk
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.owner_id IS NULL
  AND d.archived_at IS NULL
  -- ARCHIVE-01 (Q-AR3 = a): a tree level shows live rows only.
  AND d.shelved_at IS NULL
  -- UNI-1974: a folder is a private container, so at the root level (NULL
  -- parent) a document the caller may read through the home row, as ACL owner
  -- or through a share is promoted when its parent FOLDER is not in the
  -- caller's own list: it shows on its own, never inside an owner's folder.
  -- "Parent listed" repeats the predicate below on the parent row (the
  -- see_all leg minus the My Folder set: a foreign My Folder is not listed).
  AND (d.parent_id IS NOT DISTINCT FROM sqlc.narg(parent_id)
       OR (sqlc.narg(parent_id)::text IS NULL
           AND d.parent_id IS NOT NULL
           AND ((sqlc.arg(member_visible) AND d.visibility = 'workspace'
                 AND d.workspace_level = ANY(sqlc.arg(share_levels)::text[]))
                OR (sqlc.arg(acl_owner) AND d.acl_owner_id = sqlc.arg(actor_id))
                OR (sqlc.arg(allow_shares) AND EXISTS (
                     SELECT 1 FROM document_shares rs
                     WHERE rs.organization_id = d.organization_id
                       AND rs.workspace_id = d.workspace_id
                       AND rs.document_id = d.id
                       AND rs.revoked_at IS NULL
                       AND rs.level = ANY(sqlc.arg(share_levels)::text[])
                       AND ((rs.principal_type = 'user' AND rs.principal_id = sqlc.arg(actor_id))
                            OR (rs.principal_type = 'organization' AND rs.principal_id = d.organization_id)
                            OR (rs.principal_type = 'workspace'
                                AND rs.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))))
           AND EXISTS (
                SELECT 1 FROM documents pf
                WHERE pf.organization_id = d.organization_id
                  AND pf.workspace_id = d.workspace_id
                  AND pf.id = d.parent_id
                  AND pf.kind = 'folder'
                  -- a personal My Folder never promotes what is shared out of it to the root
                  AND pf.system_kind IS NULL
                  AND NOT COALESCE(
                    (sqlc.arg(see_all)
                     AND (pf.system_kind IS NULL OR pf.system_kind <> 'my_folder'
                          OR pf.acl_owner_id = sqlc.arg(actor_id)
                          OR (pf.visibility = 'workspace' AND pf.workspace_level = ANY(sqlc.arg(share_levels)::text[]))))
                    OR (sqlc.arg(member_visible) AND pf.visibility = 'workspace'
                        AND pf.workspace_level = ANY(sqlc.arg(share_levels)::text[]))
                    OR (sqlc.arg(acl_owner) AND pf.acl_owner_id = sqlc.arg(actor_id))
                    OR (sqlc.arg(allow_shares) AND EXISTS (
                         SELECT 1 FROM document_shares ps
                         WHERE ps.organization_id = pf.organization_id
                           AND ps.workspace_id = pf.workspace_id
                           AND ps.document_id = pf.id
                           AND ps.revoked_at IS NULL
                           AND ((ps.principal_type = 'user' AND ps.principal_id = sqlc.arg(actor_id))
                                OR (ps.principal_type = 'organization' AND ps.principal_id = pf.organization_id)
                                OR (ps.principal_type = 'workspace'
                                    AND ps.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))),
                    false))))
  AND ((sqlc.arg(see_all)
        AND (d.system_kind IS NULL OR d.system_kind <> 'my_folder' OR d.acl_owner_id = sqlc.arg(actor_id))
        -- MYFOLDER-01 (UNI-1891): exclude a foreign My Folder row the see_all
        -- (admin) leg would otherwise add. The row stays when the actor is
        -- its ACL owner, it is workspace-visible at share_levels (what the
        -- member predicate would admit), or it is not in the foreign set; a
        -- live share is the OR below. Removes only what admin scope ADDS.
        -- Set: uw_my_folder_foreign_ids (migration 9991792289293597).
        AND (d.acl_owner_id = sqlc.arg(actor_id)
             OR (d.visibility = 'workspace' AND d.workspace_level = ANY(sqlc.arg(share_levels)::text[]))
             OR NOT EXISTS (
                  SELECT 1 FROM uw_my_folder_foreign_ids(
                    sqlc.arg(actor_id), sqlc.arg(organization_id), sqlc.arg(workspace_id), sqlc.arg(max_level)::int
                  ) mfs WHERE mfs.document_id = d.id)))
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
  AND (sqlc.narg(format)::text IS NULL
       OR d.kind = 'folder'
       OR (d.kind = 'file'
           AND (cv.mime_type = sqlc.narg(format_mime)::text
                OR ((cv.mime_type IS NULL OR NOT (cv.mime_type = ANY(sqlc.arg(format_mimes)::text[])))
                    AND length(d.title) > length(sqlc.narg(format)::text) + 1
                    AND right(lower(d.title), length(sqlc.narg(format)::text) + 1) = '.' || sqlc.narg(format)::text))))
  AND (sqlc.narg(access)::text IS NULL
       OR (sqlc.narg(access)::text = 'restricted' AND d.visibility = 'restricted')
       OR (sqlc.narg(access)::text <> 'restricted'
           AND ((sqlc.arg(see_all) AND NOT (d.visibility = 'restricted'
                                            AND NOT (d.acl_owner_id IS NOT NULL AND d.acl_owner_id = sqlc.arg(actor_id))))
                OR (sqlc.arg(acl_owner) AND d.acl_owner_id IS NOT NULL AND d.acl_owner_id = sqlc.arg(actor_id))
                OR (sqlc.arg(member_visible) AND NOT sqlc.arg(agent)::boolean
                    AND d.visibility = 'workspace'
                    AND d.workspace_level = ANY(sqlc.arg(access_levels)::text[]))
                OR (sqlc.arg(allow_shares) AND EXISTS (
                     SELECT 1 FROM document_shares a
                     WHERE a.organization_id = d.organization_id
                       AND a.workspace_id = d.workspace_id
                       AND a.document_id = d.id
                       AND a.revoked_at IS NULL
                       AND a.level = ANY(sqlc.arg(access_levels)::text[])
                       AND ((a.principal_type = 'user' AND a.principal_id = sqlc.arg(actor_id))
                            OR (a.principal_type = 'organization' AND a.principal_id = d.organization_id)
                            OR (a.principal_type = 'workspace' AND a.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))))))
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
  -- UNI-2038 S3 keyset of a sorted page: (key, id) past the cursor row in the
  -- requested direction; an editor-less row (editor_null) is always last.
  AND (sqlc.narg(sort_cursor_id)::text IS NULL OR CASE sqlc.narg(sort_key)::text
       WHEN 'updated' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (d.updated_at, d.id COLLATE "C") < (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (d.updated_at, d.id COLLATE "C") > (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
       WHEN 'size' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.size_key, d.id COLLATE "C") < (sqlc.narg(sort_cursor_num)::bigint, sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.size_key, d.id COLLATE "C") > (sqlc.narg(sort_cursor_num)::bigint, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
       WHEN 'name' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.name_key COLLATE "vi-x-icu", d.id COLLATE "C") < (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.name_key COLLATE "vi-x-icu", d.id COLLATE "C") > (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C") END
       WHEN 'editor' THEN (sk.editor_null::int > sqlc.narg(sort_cursor_null)::boolean::int
            OR (sk.editor_null = sqlc.narg(sort_cursor_null)::boolean
                AND CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.editor_key COLLATE "vi-x-icu", d.id COLLATE "C") < (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.editor_key COLLATE "vi-x-icu", d.id COLLATE "C") > (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C") END))
       ELSE true END)
-- UNI-2038 S3: no sort_key keeps the list's own order (the first two terms);
-- a sort_key orders by (key, id) in one direction. Every term is a CASE on a
-- bound parameter, so the planner folds the unused ones away and a plain
-- (key, id) order remains.
ORDER BY
  (CASE WHEN sqlc.narg(sort_key)::text IS NULL THEN d.position END),
  (CASE WHEN sqlc.narg(sort_key)::text IS NULL THEN d.id END),
  (CASE WHEN sqlc.narg(sort_key)::text = 'editor' THEN sk.editor_null END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'name' AND NOT sqlc.arg(sort_desc)::boolean THEN sk.name_key
        WHEN sqlc.narg(sort_key)::text = 'editor' AND NOT sqlc.arg(sort_desc)::boolean THEN sk.editor_key END) COLLATE "vi-x-icu" ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'name' AND sqlc.arg(sort_desc)::boolean THEN sk.name_key
        WHEN sqlc.narg(sort_key)::text = 'editor' AND sqlc.arg(sort_desc)::boolean THEN sk.editor_key END) COLLATE "vi-x-icu" DESC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'size' AND NOT sqlc.arg(sort_desc)::boolean THEN sk.size_key END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'size' AND sqlc.arg(sort_desc)::boolean THEN sk.size_key END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'updated' AND NOT sqlc.arg(sort_desc)::boolean THEN d.updated_at END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'updated' AND sqlc.arg(sort_desc)::boolean THEN d.updated_at END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text IS NOT NULL AND NOT sqlc.arg(sort_desc)::boolean THEN d.id COLLATE "C" END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text IS NOT NULL AND sqlc.arg(sort_desc)::boolean THEN d.id COLLATE "C" END) DESC
LIMIT sqlc.arg(page_limit);

-- The trash view: manage or edit (workspace admin, the ACL owner, a
-- workspace-visible document with workspace_level = 'edit' for a human
-- workspace member, or a manage/edit share), ordered by archive time
-- descending.
-- name: ListArchivedDocumentsPage :many
SELECT sqlc.embed(d),
       sk.name_key AS sort_name, sk.size_key AS sort_size,
       sk.editor_key AS sort_editor, sk.editor_null AS sort_editor_null,
       sk.ts_key AS sort_at
FROM documents d
LEFT JOIN document_versions cv
  ON cv.organization_id = d.organization_id
 AND cv.workspace_id = d.workspace_id
 AND cv.document_id = d.id
 AND cv.id = d.file_version_id
-- UNI-2038 S3 + UNI-2045: the sort keys of a row, computed once (see
-- ListDocumentsPage). ts_key is the timestamp of the timestamp sorts: updated_at
-- for sort=updated, the list's own column for its screen key (and for no sort),
-- so it is also the time half of the next cursor.
LEFT JOIN users eu
  ON eu.id = d.updated_by
 AND d.updated_by_kind = 'human'
 AND sqlc.narg(sort_key)::text = 'editor'
CROSS JOIN LATERAL (SELECT
    (CASE WHEN sqlc.narg(sort_key)::text = 'name' THEN d.title ELSE '' END COLLATE "vi-x-icu")::text AS name_key,
    (CASE WHEN sqlc.narg(sort_key)::text = 'size' THEN COALESCE(cv.size_bytes, 0) ELSE 0 END)::bigint AS size_key,
    (CASE WHEN sqlc.narg(sort_key)::text = 'editor' THEN COALESCE(eu.display_name COLLATE "vi-x-icu", '') ELSE '' END)::text AS editor_key,
    (CASE WHEN sqlc.narg(sort_key)::text = 'editor' THEN NULLIF(btrim(eu.display_name), '') IS NULL ELSE false END)::boolean AS editor_null,
    (CASE WHEN sqlc.narg(sort_key)::text = 'updated' THEN d.updated_at ELSE d.archived_at END)::timestamptz AS ts_key
) sk
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.owner_id IS NULL
  AND d.archived_at IS NOT NULL
  AND ((sqlc.arg(see_all)
        AND (d.system_kind IS NULL OR d.system_kind <> 'my_folder' OR d.acl_owner_id = sqlc.arg(actor_id))
        -- MYFOLDER-01 (UNI-1891): exclude a foreign My Folder row the see_all
        -- (admin) leg would otherwise add. The row stays when the actor is
        -- its ACL owner, it is workspace-visible at share_levels (what the
        -- member predicate would admit), or it is not in the foreign set; a
        -- live share is the OR below. Removes only what admin scope ADDS.
        -- Set: uw_my_folder_foreign_ids (migration 9991792289293597).
        AND (d.acl_owner_id = sqlc.arg(actor_id)
             OR (d.visibility = 'workspace' AND d.workspace_level = ANY(sqlc.arg(share_levels)::text[]))
             OR NOT EXISTS (
                  SELECT 1 FROM uw_my_folder_foreign_ids(
                    sqlc.arg(actor_id), sqlc.arg(organization_id), sqlc.arg(workspace_id), sqlc.arg(max_level)::int
                  ) mfs WHERE mfs.document_id = d.id)))
       OR (sqlc.arg(acl_owner) AND d.acl_owner_id = sqlc.arg(actor_id))
       OR (sqlc.arg(member_visible) AND NOT sqlc.arg(agent)::boolean
           AND d.visibility = 'workspace'
           AND d.workspace_level = 'edit')
       OR (sqlc.arg(allow_shares) AND EXISTS (
            SELECT 1 FROM document_shares s
            WHERE s.organization_id = d.organization_id
              AND s.workspace_id = d.workspace_id
              AND s.document_id = d.id
              AND s.revoked_at IS NULL
              AND s.level IN ('manage', 'edit')
              AND ((s.principal_type = 'user' AND s.principal_id = sqlc.arg(actor_id))
                   OR (s.principal_type = 'organization' AND s.principal_id = d.organization_id)
                   OR (s.principal_type = 'workspace'
                       AND s.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))))
  AND (sqlc.narg(kind)::text IS NULL OR d.kind = sqlc.narg(kind))
  AND (sqlc.narg(exclude_kind)::text IS NULL OR d.kind <> sqlc.narg(exclude_kind))
  AND (sqlc.narg(updated_by)::text IS NULL OR d.updated_by = sqlc.narg(updated_by))
  AND (sqlc.narg(updated_from)::timestamptz IS NULL OR d.archived_at >= sqlc.narg(updated_from))
  AND (sqlc.narg(updated_to)::timestamptz IS NULL OR d.archived_at < sqlc.narg(updated_to))
  AND (sqlc.narg(format)::text IS NULL
       OR d.kind = 'folder'
       OR (d.kind = 'file'
           AND (cv.mime_type = sqlc.narg(format_mime)::text
                OR ((cv.mime_type IS NULL OR NOT (cv.mime_type = ANY(sqlc.arg(format_mimes)::text[])))
                    AND length(d.title) > length(sqlc.narg(format)::text) + 1
                    AND right(lower(d.title), length(sqlc.narg(format)::text) + 1) = '.' || sqlc.narg(format)::text))))
  -- UNI-1868: every row this view can return is already manage (the ladder
  -- above is manage-only), so the service refuses access=manage/edit here and
  -- 'restricted' - the row's visibility - is the one access filter it takes.
  AND (sqlc.narg(access)::text IS NULL OR d.visibility = 'restricted')
  -- A term can match on title for every row this view returns; it may match
  -- on content (search_text) only for a row the caller can act on AND read:
  -- managed by the caller's own access (flagged ACL owner - an effective
  -- member the resolver grants manage to - or a live manage share), or admin
  -- scope (see_all) on a non-restricted row. A break-glass grant is capped at
  -- view, so it never qualifies here and its holder falls to the title
  -- branch. A restricted trashed row reached only through AdminScope matches
  -- on title alone - admins administer it but never read its content, and an
  -- edit holder's trash is read-only metadata either way (RESTORE-01 §3).
  AND (sqlc.narg(query)::text IS NULL
       OR (NOT sqlc.arg(match_title)::boolean
           AND ((sqlc.arg(see_all)
                 AND (d.system_kind IS NULL OR d.system_kind <> 'my_folder' OR d.acl_owner_id = sqlc.arg(actor_id))
                 AND d.visibility <> 'restricted')
                OR (sqlc.arg(acl_owner)::boolean AND d.acl_owner_id = sqlc.arg(actor_id))
                OR (sqlc.arg(allow_shares) AND EXISTS (
                     SELECT 1 FROM document_shares rs
                     WHERE rs.organization_id = d.organization_id
                       AND rs.workspace_id = d.workspace_id
                       AND rs.document_id = d.id
                       AND rs.revoked_at IS NULL
                       AND rs.level = 'manage'
                       AND ((rs.principal_type = 'user' AND rs.principal_id = sqlc.arg(actor_id))
                            OR (rs.principal_type = 'organization' AND rs.principal_id = d.organization_id)
                            OR (rs.principal_type = 'workspace'
                                AND rs.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))))
           AND d.search_text ILIKE '%' || sqlc.narg(query)::text || '%' ESCAPE '\')
       OR ((sqlc.arg(match_title)::boolean
            OR NOT ((sqlc.arg(see_all)
                     AND (d.system_kind IS NULL OR d.system_kind <> 'my_folder' OR d.acl_owner_id = sqlc.arg(actor_id))
                     AND d.visibility <> 'restricted')
                    OR (sqlc.arg(acl_owner)::boolean AND d.acl_owner_id = sqlc.arg(actor_id))
                    OR (sqlc.arg(allow_shares) AND EXISTS (
                         SELECT 1 FROM document_shares rs
                         WHERE rs.organization_id = d.organization_id
                           AND rs.workspace_id = d.workspace_id
                           AND rs.document_id = d.id
                           AND rs.revoked_at IS NULL
                           AND rs.level = 'manage'
                           AND ((rs.principal_type = 'user' AND rs.principal_id = sqlc.arg(actor_id))
                                OR (rs.principal_type = 'organization' AND rs.principal_id = d.organization_id)
                                OR (rs.principal_type = 'workspace'
                                    AND rs.principal_id = ANY(sqlc.arg(share_workspaces)::text[])))))))
           AND uw_fold_search(d.title) ILIKE '%' || sqlc.narg(query)::text || '%' ESCAPE '\'))
  AND (sqlc.narg(cursor_at)::timestamptz IS NULL
       OR (d.archived_at, d.id) < (sqlc.narg(cursor_at), sqlc.narg(cursor_id)::text))
  -- UNI-2038 S3 keyset of a sorted page: (key, id) past the cursor row in the
  -- requested direction; an editor-less row (editor_null) is always last.
  AND (sqlc.narg(sort_cursor_id)::text IS NULL OR CASE sqlc.narg(sort_key)::text
       WHEN 'updated' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.ts_key, d.id COLLATE "C") < (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.ts_key, d.id COLLATE "C") > (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
       WHEN 'deleted' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.ts_key, d.id COLLATE "C") < (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.ts_key, d.id COLLATE "C") > (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
       WHEN 'size' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.size_key, d.id COLLATE "C") < (sqlc.narg(sort_cursor_num)::bigint, sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.size_key, d.id COLLATE "C") > (sqlc.narg(sort_cursor_num)::bigint, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
       WHEN 'name' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.name_key COLLATE "vi-x-icu", d.id COLLATE "C") < (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.name_key COLLATE "vi-x-icu", d.id COLLATE "C") > (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C") END
       WHEN 'editor' THEN (sk.editor_null::int > sqlc.narg(sort_cursor_null)::boolean::int
            OR (sk.editor_null = sqlc.narg(sort_cursor_null)::boolean
                AND CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.editor_key COLLATE "vi-x-icu", d.id COLLATE "C") < (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.editor_key COLLATE "vi-x-icu", d.id COLLATE "C") > (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C") END))
       ELSE true END)
-- UNI-2038 S3 + UNI-2045: no sort_key keeps the list's own order (the first two
-- terms); a sort_key orders by (key, id) in one direction. Every term is a CASE
-- on a bound parameter, so the planner folds the unused ones away.
ORDER BY
  (CASE WHEN sqlc.narg(sort_key)::text IS NULL THEN d.archived_at END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text IS NULL THEN d.id END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'editor' THEN sk.editor_null END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'name' AND NOT sqlc.arg(sort_desc)::boolean THEN sk.name_key
        WHEN sqlc.narg(sort_key)::text = 'editor' AND NOT sqlc.arg(sort_desc)::boolean THEN sk.editor_key END) COLLATE "vi-x-icu" ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'name' AND sqlc.arg(sort_desc)::boolean THEN sk.name_key
        WHEN sqlc.narg(sort_key)::text = 'editor' AND sqlc.arg(sort_desc)::boolean THEN sk.editor_key END) COLLATE "vi-x-icu" DESC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'size' AND NOT sqlc.arg(sort_desc)::boolean THEN sk.size_key END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'size' AND sqlc.arg(sort_desc)::boolean THEN sk.size_key END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text IN ('updated', 'deleted') AND NOT sqlc.arg(sort_desc)::boolean THEN sk.ts_key END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text IN ('updated', 'deleted') AND sqlc.arg(sort_desc)::boolean THEN sk.ts_key END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text IS NOT NULL AND NOT sqlc.arg(sort_desc)::boolean THEN d.id COLLATE "C" END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text IS NOT NULL AND sqlc.arg(sort_desc)::boolean THEN d.id COLLATE "C" END) DESC
LIMIT sqlc.arg(page_limit);

-- The archive shelf (ARCHIVE-01, UNI-1845; addendum §4): GET .../documents?
-- shelved=true. Shelved-but-not-trashed rows the caller can VIEW - the flat
-- list's permission ladder at view level, not the trash's manage/edit gate -
-- keyset (shelved_at, id) descending. The format/access filters are the same
-- LISTFILTER pair the flat list takes; updated_* windows shelved_at like the
-- trash windows archived_at. q= runs the same content-vs-title rule as the
-- flat list (a see_all caller on a restricted row reads title only).
-- name: ListShelvedDocumentsPage :many
SELECT sqlc.embed(d),
       sk.name_key AS sort_name, sk.size_key AS sort_size,
       sk.editor_key AS sort_editor, sk.editor_null AS sort_editor_null,
       sk.ts_key AS sort_at
FROM documents d
LEFT JOIN document_versions cv
  ON cv.organization_id = d.organization_id
 AND cv.workspace_id = d.workspace_id
 AND cv.document_id = d.id
 AND cv.id = d.file_version_id
-- UNI-2038 S3 + UNI-2045: the sort keys of a row, computed once (see
-- ListDocumentsPage). ts_key is the timestamp of the timestamp sorts: updated_at
-- for sort=updated, the list's own column for its screen key (and for no sort),
-- so it is also the time half of the next cursor.
LEFT JOIN users eu
  ON eu.id = d.updated_by
 AND d.updated_by_kind = 'human'
 AND sqlc.narg(sort_key)::text = 'editor'
CROSS JOIN LATERAL (SELECT
    (CASE WHEN sqlc.narg(sort_key)::text = 'name' THEN d.title ELSE '' END COLLATE "vi-x-icu")::text AS name_key,
    (CASE WHEN sqlc.narg(sort_key)::text = 'size' THEN COALESCE(cv.size_bytes, 0) ELSE 0 END)::bigint AS size_key,
    (CASE WHEN sqlc.narg(sort_key)::text = 'editor' THEN COALESCE(eu.display_name COLLATE "vi-x-icu", '') ELSE '' END)::text AS editor_key,
    (CASE WHEN sqlc.narg(sort_key)::text = 'editor' THEN NULLIF(btrim(eu.display_name), '') IS NULL ELSE false END)::boolean AS editor_null,
    (CASE WHEN sqlc.narg(sort_key)::text = 'updated' THEN d.updated_at ELSE d.shelved_at END)::timestamptz AS ts_key
) sk
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.owner_id IS NULL
  AND d.shelved_at IS NOT NULL
  AND d.archived_at IS NULL
  AND ((sqlc.arg(see_all)
        AND (d.system_kind IS NULL OR d.system_kind <> 'my_folder' OR d.acl_owner_id = sqlc.arg(actor_id)))
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
  AND (sqlc.narg(updated_from)::timestamptz IS NULL OR d.shelved_at >= sqlc.narg(updated_from))
  AND (sqlc.narg(updated_to)::timestamptz IS NULL OR d.shelved_at < sqlc.narg(updated_to))
  AND (sqlc.narg(format)::text IS NULL
       OR d.kind = 'folder'
       OR (d.kind = 'file'
           AND (cv.mime_type = sqlc.narg(format_mime)::text
                OR ((cv.mime_type IS NULL OR NOT (cv.mime_type = ANY(sqlc.arg(format_mimes)::text[])))
                    AND length(d.title) > length(sqlc.narg(format)::text) + 1
                    AND right(lower(d.title), length(sqlc.narg(format)::text) + 1) = '.' || sqlc.narg(format)::text))))
  AND (sqlc.narg(access)::text IS NULL
       OR (sqlc.narg(access)::text = 'restricted' AND d.visibility = 'restricted')
       OR (sqlc.narg(access)::text <> 'restricted'
           AND ((sqlc.arg(see_all) AND NOT (d.visibility = 'restricted'
                                            AND NOT (d.acl_owner_id IS NOT NULL AND d.acl_owner_id = sqlc.arg(actor_id))))
                OR (sqlc.arg(acl_owner) AND d.acl_owner_id IS NOT NULL AND d.acl_owner_id = sqlc.arg(actor_id))
                OR (sqlc.arg(member_visible) AND NOT sqlc.arg(agent)::boolean
                    AND d.visibility = 'workspace'
                    AND d.workspace_level = ANY(sqlc.arg(access_levels)::text[]))
                OR (sqlc.arg(allow_shares) AND EXISTS (
                     SELECT 1 FROM document_shares a
                     WHERE a.organization_id = d.organization_id
                       AND a.workspace_id = d.workspace_id
                       AND a.document_id = d.id
                       AND a.revoked_at IS NULL
                       AND a.level = ANY(sqlc.arg(access_levels)::text[])
                       AND ((a.principal_type = 'user' AND a.principal_id = sqlc.arg(actor_id))
                            OR (a.principal_type = 'organization' AND a.principal_id = d.organization_id)
                            OR (a.principal_type = 'workspace' AND a.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))))))
  -- System rows (My Folder) are never "shared by me", same as the flat list.
  AND (NOT sqlc.arg(shared_by_me)::boolean OR d.system_kind IS NULL)
  AND (NOT sqlc.arg(shared_by_me)::boolean
       OR ((sqlc.arg(see_all)::boolean OR sqlc.arg(acl_owner)::boolean)
           AND d.acl_owner_id IS NOT NULL
           AND d.acl_owner_id = sqlc.arg(actor_id)
           AND (d.visibility = 'workspace'
                OR EXISTS (
                     SELECT 1 FROM document_shares sbm
                     WHERE sbm.organization_id = d.organization_id
                       AND sbm.workspace_id = d.workspace_id
                       AND sbm.document_id = d.id
                       AND sbm.revoked_at IS NULL
                       AND ((sbm.principal_type = 'user')
                            OR (sbm.principal_type = 'workspace')
                            OR (sbm.principal_type = 'organization' AND sbm.principal_id = d.organization_id))))
           -- UNI-1973: show only the topmost shared item. A row whose sharing is
           -- just the workspace visibility copied from its parent at create time
           -- (same level, no live share of its own) is hidden when that parent is
           -- a live non-folder row the caller owns, shared the same way (children of a
           -- folder always show: folders are not shareable, UNI-1974).
           AND NOT (d.visibility = 'workspace'
                    AND NOT EXISTS (
                         SELECT 1 FROM document_shares ow
                         WHERE ow.organization_id = d.organization_id
                           AND ow.workspace_id = d.workspace_id
                           AND ow.document_id = d.id
                           AND ow.revoked_at IS NULL)
                    AND EXISTS (
                         SELECT 1 FROM documents sp
                         WHERE sp.organization_id = d.organization_id
                           AND sp.workspace_id = d.workspace_id
                           AND sp.id = d.parent_id
                           AND sp.owner_id IS NULL
                           AND sp.archived_at IS NULL
                           AND sp.system_kind IS NULL
                           AND sp.kind <> 'folder'
                           AND sp.acl_owner_id = d.acl_owner_id
                           AND sp.visibility = 'workspace'
                           AND sp.workspace_level = d.workspace_level))))
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
       OR (d.shelved_at, d.id) < (sqlc.narg(cursor_at), sqlc.narg(cursor_id)::text))
  -- UNI-2038 S3 keyset of a sorted page: (key, id) past the cursor row in the
  -- requested direction; an editor-less row (editor_null) is always last.
  AND (sqlc.narg(sort_cursor_id)::text IS NULL OR CASE sqlc.narg(sort_key)::text
       WHEN 'updated' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.ts_key, d.id COLLATE "C") < (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.ts_key, d.id COLLATE "C") > (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
       WHEN 'shelved' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.ts_key, d.id COLLATE "C") < (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.ts_key, d.id COLLATE "C") > (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
       WHEN 'size' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.size_key, d.id COLLATE "C") < (sqlc.narg(sort_cursor_num)::bigint, sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.size_key, d.id COLLATE "C") > (sqlc.narg(sort_cursor_num)::bigint, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
       WHEN 'name' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.name_key COLLATE "vi-x-icu", d.id COLLATE "C") < (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.name_key COLLATE "vi-x-icu", d.id COLLATE "C") > (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C") END
       WHEN 'editor' THEN (sk.editor_null::int > sqlc.narg(sort_cursor_null)::boolean::int
            OR (sk.editor_null = sqlc.narg(sort_cursor_null)::boolean
                AND CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.editor_key COLLATE "vi-x-icu", d.id COLLATE "C") < (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.editor_key COLLATE "vi-x-icu", d.id COLLATE "C") > (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C") END))
       ELSE true END)
-- UNI-2038 S3 + UNI-2045: no sort_key keeps the list's own order (the first two
-- terms); a sort_key orders by (key, id) in one direction. Every term is a CASE
-- on a bound parameter, so the planner folds the unused ones away.
ORDER BY
  (CASE WHEN sqlc.narg(sort_key)::text IS NULL THEN d.shelved_at END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text IS NULL THEN d.id END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'editor' THEN sk.editor_null END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'name' AND NOT sqlc.arg(sort_desc)::boolean THEN sk.name_key
        WHEN sqlc.narg(sort_key)::text = 'editor' AND NOT sqlc.arg(sort_desc)::boolean THEN sk.editor_key END) COLLATE "vi-x-icu" ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'name' AND sqlc.arg(sort_desc)::boolean THEN sk.name_key
        WHEN sqlc.narg(sort_key)::text = 'editor' AND sqlc.arg(sort_desc)::boolean THEN sk.editor_key END) COLLATE "vi-x-icu" DESC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'size' AND NOT sqlc.arg(sort_desc)::boolean THEN sk.size_key END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'size' AND sqlc.arg(sort_desc)::boolean THEN sk.size_key END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text IN ('updated', 'shelved') AND NOT sqlc.arg(sort_desc)::boolean THEN sk.ts_key END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text IN ('updated', 'shelved') AND sqlc.arg(sort_desc)::boolean THEN sk.ts_key END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text IS NOT NULL AND NOT sqlc.arg(sort_desc)::boolean THEN d.id COLLATE "C" END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text IS NOT NULL AND sqlc.arg(sort_desc)::boolean THEN d.id COLLATE "C" END) DESC
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
  -- ARCHIVE-01 (Q-AR3 = a): shelved nodes leave the tree; a live child of a
  -- shelved parent (partial unshelve) is not floated - the service drops the
  -- edge to a parent the result set does not hold.
  AND d.shelved_at IS NULL
  AND ((sqlc.arg(see_all)
        AND (d.system_kind IS NULL OR d.system_kind <> 'my_folder' OR d.acl_owner_id = sqlc.arg(actor_id))
        -- MYFOLDER-01 (UNI-1891): exclude a foreign My Folder row the see_all
        -- (admin) leg would otherwise add. The row stays when the actor is
        -- its ACL owner, it is workspace-visible at share_levels (what the
        -- member predicate would admit), or it is not in the foreign set; a
        -- live share is the OR below. Removes only what admin scope ADDS.
        -- Set: uw_my_folder_foreign_ids (migration 9991792289293597).
        AND (d.acl_owner_id = sqlc.arg(actor_id)
             OR (d.visibility = 'workspace' AND d.workspace_level = ANY(sqlc.arg(share_levels)::text[]))
             OR NOT EXISTS (
                  SELECT 1 FROM uw_my_folder_foreign_ids(
                    sqlc.arg(actor_id), sqlc.arg(organization_id), sqlc.arg(workspace_id), sqlc.arg(max_level)::int
                  ) mfs WHERE mfs.document_id = d.id)))
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

-- "Recent": documents the actor touched - opened (an access-log row of theirs),
-- edited (updated_by) or commented (a comment of theirs) - permission-filtered.
-- UNI-2045 SV-1: every row carries the caller's last activity (kind + time, the
-- latest of the three) and sort=activity orders by it; activity=opened|edited
-- keeps the rows the caller opened / edited.
-- name: ListRecentDocumentsPage :many
SELECT sqlc.embed(d),
       sk.name_key AS sort_name, sk.size_key AS sort_size,
       sk.editor_key AS sort_editor, sk.editor_null AS sort_editor_null,
       sk.ts_key AS sort_at, act.kind AS activity_kind, act.last_at AS activity_at
FROM documents d
LEFT JOIN document_versions cv
  ON cv.organization_id = d.organization_id
 AND cv.workspace_id = d.workspace_id
 AND cv.document_id = d.id
 AND cv.id = d.file_version_id
-- The caller's own activity on the row: the last access-log row (any action of
-- a person's own read), their edit (updated_by = them, at updated_at; there is
-- no per-edit history, versions are snapshots) and their last live comment. The
-- two aggregates read the caller's own rows once instead of probing every
-- document (a probe per row cost seconds on a 10k-document workspace).
LEFT JOIN (
  SELECT a.document_id, max(a.occurred_at) AS seen_at
  FROM document_access_logs a
  WHERE a.organization_id = sqlc.arg(organization_id)
    AND a.workspace_id = sqlc.arg(workspace_id)
    AND a.actor_id = sqlc.arg(actor_id)::text
  GROUP BY a.document_id
) op ON op.document_id = d.id
LEFT JOIN (
  SELECT c.document_id, max(c.created_at) AS said_at
  FROM document_comments c
  WHERE c.organization_id = sqlc.arg(organization_id)
    AND c.workspace_id = sqlc.arg(workspace_id)
    AND c.author_id = sqlc.arg(actor_id)::text
    AND c.author_kind = 'human'
    AND c.deleted_at IS NULL
  GROUP BY c.document_id
) cm ON cm.document_id = d.id
-- UNI-2012 F5: with include_owned the caller's ownership counts as activity at
-- the row's updated_at, so a document they own stays listed after someone else
-- edits it (the chat picker's empty-query list). Off, it adds nothing.
CROSS JOIN LATERAL (SELECT
    (CASE WHEN sqlc.arg(include_owned)::boolean AND d.acl_owner_id = sqlc.arg(actor_id)::text THEN d.updated_at END)::timestamptz AS at
) own
CROSS JOIN LATERAL (SELECT
    GREATEST(op.seen_at, (CASE WHEN d.updated_by = sqlc.arg(actor_id)::text THEN d.updated_at END), cm.said_at, own.at)::timestamptz AS last_at,
    (CASE WHEN d.updated_by = sqlc.arg(actor_id)::text
               AND d.updated_at = GREATEST(op.seen_at, d.updated_at, cm.said_at) THEN 'edited'
          WHEN cm.said_at IS NOT NULL AND cm.said_at = GREATEST(op.seen_at, (CASE WHEN d.updated_by = sqlc.arg(actor_id)::text THEN d.updated_at END), cm.said_at, own.at) THEN 'commented'
          WHEN own.at IS NOT NULL AND (op.seen_at IS NULL OR op.seen_at < own.at) THEN 'owned'
          ELSE 'opened' END)::text AS kind
) act
-- UNI-2038 S3: the sort keys of a row, computed once. The name key is the
-- title itself under the Vietnamese ICU collation (Đ sorts after D, tones and
-- case variants stay together, whatever the database locale is); the size key is the current
-- file version's size (0 for a page or a folder); the editor key is the last
-- editor's display name (same collation), and only a human editor with a name has one - an
-- agent, a removed account or a blank name sets editor_null and sorts last. Each
-- key is computed only under its own sort (the others are constants), so an
-- unsorted list pays nothing for them and the users join runs for sort=editor.
LEFT JOIN users eu
  ON eu.id = d.updated_by
 AND d.updated_by_kind = 'human'
 AND sqlc.narg(sort_key)::text = 'editor'
CROSS JOIN LATERAL (SELECT
    (CASE WHEN sqlc.narg(sort_key)::text = 'name' THEN d.title ELSE '' END COLLATE "vi-x-icu")::text AS name_key,
    (CASE WHEN sqlc.narg(sort_key)::text = 'size' THEN COALESCE(cv.size_bytes, 0) ELSE 0 END)::bigint AS size_key,
    (CASE WHEN sqlc.narg(sort_key)::text = 'editor' THEN COALESCE(eu.display_name COLLATE "vi-x-icu", '') ELSE '' END)::text AS editor_key,
    (CASE WHEN sqlc.narg(sort_key)::text = 'editor' THEN NULLIF(btrim(eu.display_name), '') IS NULL ELSE false END)::boolean AS editor_null,
    (CASE WHEN sqlc.narg(sort_key)::text = 'activity' THEN act.last_at ELSE d.updated_at END)::timestamptz AS ts_key
) sk
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.owner_id IS NULL
  AND d.archived_at IS NULL
  -- ARCHIVE-01 (Q-AR3 = a): recent is a normal list - shelved rows leave it.
  AND d.shelved_at IS NULL
  AND act.last_at IS NOT NULL
  AND (sqlc.narg(activity)::text IS NULL
       OR (sqlc.narg(activity)::text = 'opened' AND op.seen_at IS NOT NULL)
       OR (sqlc.narg(activity)::text = 'edited' AND d.updated_by = sqlc.arg(actor_id)::text))
  AND (sqlc.narg(updated_by)::text IS NULL OR d.updated_by = sqlc.narg(updated_by))
  AND (sqlc.narg(updated_from)::timestamptz IS NULL OR d.updated_at >= sqlc.narg(updated_from))
  AND (sqlc.narg(updated_to)::timestamptz IS NULL OR d.updated_at < sqlc.narg(updated_to))
  AND (sqlc.narg(format)::text IS NULL
       OR d.kind = 'folder'
       OR (d.kind = 'file'
           AND (cv.mime_type = sqlc.narg(format_mime)::text
                OR ((cv.mime_type IS NULL OR NOT (cv.mime_type = ANY(sqlc.arg(format_mimes)::text[])))
                    AND length(d.title) > length(sqlc.narg(format)::text) + 1
                    AND right(lower(d.title), length(sqlc.narg(format)::text) + 1) = '.' || sqlc.narg(format)::text))))
  AND (sqlc.narg(access)::text IS NULL
       OR (sqlc.narg(access)::text = 'restricted' AND d.visibility = 'restricted')
       OR (sqlc.narg(access)::text <> 'restricted'
           AND ((sqlc.arg(see_all) AND NOT (d.visibility = 'restricted'
                                            AND NOT (d.acl_owner_id IS NOT NULL AND d.acl_owner_id = sqlc.arg(actor_id))))
                OR (sqlc.arg(acl_owner) AND d.acl_owner_id IS NOT NULL AND d.acl_owner_id = sqlc.arg(actor_id))
                OR (sqlc.arg(member_visible) AND NOT sqlc.arg(agent)::boolean
                    AND d.visibility = 'workspace'
                    AND d.workspace_level = ANY(sqlc.arg(access_levels)::text[]))
                OR (sqlc.arg(allow_shares) AND EXISTS (
                     SELECT 1 FROM document_shares a
                     WHERE a.organization_id = d.organization_id
                       AND a.workspace_id = d.workspace_id
                       AND a.document_id = d.id
                       AND a.revoked_at IS NULL
                       AND a.level = ANY(sqlc.arg(access_levels)::text[])
                       AND ((a.principal_type = 'user' AND a.principal_id = sqlc.arg(actor_id))
                            OR (a.principal_type = 'organization' AND a.principal_id = d.organization_id)
                            OR (a.principal_type = 'workspace' AND a.principal_id = ANY(sqlc.arg(share_workspaces)::text[]))))))))
  AND ((sqlc.arg(see_all)
        AND (d.system_kind IS NULL OR d.system_kind <> 'my_folder' OR d.acl_owner_id = sqlc.arg(actor_id))
        -- MYFOLDER-01 (UNI-1891): exclude a foreign My Folder row the see_all
        -- (admin) leg would otherwise add. The row stays when the actor is
        -- its ACL owner, it is workspace-visible at share_levels (what the
        -- member predicate would admit), or it is not in the foreign set; a
        -- live share is the OR below. Removes only what admin scope ADDS.
        -- Set: uw_my_folder_foreign_ids (migration 9991792289293597).
        AND (d.acl_owner_id = sqlc.arg(actor_id)
             OR (d.visibility = 'workspace' AND d.workspace_level = ANY(sqlc.arg(share_levels)::text[]))
             OR NOT EXISTS (
                  SELECT 1 FROM uw_my_folder_foreign_ids(
                    sqlc.arg(actor_id), sqlc.arg(organization_id), sqlc.arg(workspace_id), sqlc.arg(max_level)::int
                  ) mfs WHERE mfs.document_id = d.id)))
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
  -- UNI-2038 S3 keyset of a sorted page: (key, id) past the cursor row in the
  -- requested direction; an editor-less row (editor_null) is always last.
  AND (sqlc.narg(sort_cursor_id)::text IS NULL OR CASE sqlc.narg(sort_key)::text
       WHEN 'updated' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (d.updated_at, d.id COLLATE "C") < (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (d.updated_at, d.id COLLATE "C") > (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
       WHEN 'activity' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.ts_key, d.id COLLATE "C") < (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.ts_key, d.id COLLATE "C") > (sqlc.narg(sort_cursor_at)::timestamptz, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
       WHEN 'size' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.size_key, d.id COLLATE "C") < (sqlc.narg(sort_cursor_num)::bigint, sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.size_key, d.id COLLATE "C") > (sqlc.narg(sort_cursor_num)::bigint, sqlc.narg(sort_cursor_id)::text COLLATE "C") END
       WHEN 'name' THEN CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.name_key COLLATE "vi-x-icu", d.id COLLATE "C") < (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.name_key COLLATE "vi-x-icu", d.id COLLATE "C") > (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C") END
       WHEN 'editor' THEN (sk.editor_null::int > sqlc.narg(sort_cursor_null)::boolean::int
            OR (sk.editor_null = sqlc.narg(sort_cursor_null)::boolean
                AND CASE WHEN sqlc.arg(sort_desc)::boolean
            THEN (sk.editor_key COLLATE "vi-x-icu", d.id COLLATE "C") < (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C")
            ELSE (sk.editor_key COLLATE "vi-x-icu", d.id COLLATE "C") > (sqlc.narg(sort_cursor_text)::text COLLATE "vi-x-icu", sqlc.narg(sort_cursor_id)::text COLLATE "C") END))
       ELSE true END)
-- UNI-2038 S3: no sort_key keeps the list's own order (the first two terms);
-- a sort_key orders by (key, id) in one direction. Every term is a CASE on a
-- bound parameter, so the planner folds the unused ones away and a plain
-- (key, id) order remains.
ORDER BY
  (CASE WHEN sqlc.narg(sort_key)::text IS NULL THEN d.updated_at END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text IS NULL THEN d.id END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'editor' THEN sk.editor_null END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'name' AND NOT sqlc.arg(sort_desc)::boolean THEN sk.name_key
        WHEN sqlc.narg(sort_key)::text = 'editor' AND NOT sqlc.arg(sort_desc)::boolean THEN sk.editor_key END) COLLATE "vi-x-icu" ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'name' AND sqlc.arg(sort_desc)::boolean THEN sk.name_key
        WHEN sqlc.narg(sort_key)::text = 'editor' AND sqlc.arg(sort_desc)::boolean THEN sk.editor_key END) COLLATE "vi-x-icu" DESC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'size' AND NOT sqlc.arg(sort_desc)::boolean THEN sk.size_key END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'size' AND sqlc.arg(sort_desc)::boolean THEN sk.size_key END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'updated' AND NOT sqlc.arg(sort_desc)::boolean THEN d.updated_at END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'updated' AND sqlc.arg(sort_desc)::boolean THEN d.updated_at END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'activity' AND NOT sqlc.arg(sort_desc)::boolean THEN sk.ts_key END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text = 'activity' AND sqlc.arg(sort_desc)::boolean THEN sk.ts_key END) DESC,
  (CASE WHEN sqlc.narg(sort_key)::text IS NOT NULL AND NOT sqlc.arg(sort_desc)::boolean THEN d.id COLLATE "C" END) ASC,
  (CASE WHEN sqlc.narg(sort_key)::text IS NOT NULL AND sqlc.arg(sort_desc)::boolean THEN d.id COLLATE "C" END) DESC
LIMIT sqlc.arg(page_limit);

-- UNI-1974: the parents of one page of list rows, read in one query so the
-- service can tell which of them the caller lists (a parent the caller does
-- not list is never named in the row: no parent_id leaves the server for it).
-- name: ListDocumentsByIDs :many
SELECT d.*
FROM documents d
WHERE d.organization_id = sqlc.arg(organization_id)
  AND d.workspace_id = sqlc.arg(workspace_id)
  AND d.id = ANY(sqlc.arg(ids)::text[]);
