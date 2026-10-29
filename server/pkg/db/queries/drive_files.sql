-- name: LockDriveFolderGraph :exec
-- Serializes Drive folder-graph mutations, workspace folder-name synchronization,
-- and file unlink/prune within a workspace transaction (D-LOCK, RB2-1, RB2-3).
SELECT pg_advisory_xact_lock(
  hashtextextended('drive_folder_graph:' || sqlc.arg('workspace_id')::text, 0)
);

-- name: TryLockDriveFolderGraph :one
-- Non-blocking variant of LockDriveFolderGraph used by opportunistic metadata
-- refresh on GET/list request paths so a busy workspace graph lock is skipped
-- without waiting (D-LOCK, D-BUSY, RB2-1, RB3-3, RB3-4).
SELECT pg_try_advisory_xact_lock(
  hashtextextended('drive_folder_graph:' || sqlc.arg('workspace_id')::text, 0)
) AS locked;

-- name: LockDriveFileWorkspaceExternal :exec
-- Serializes Link operations for the same (workspace_id, external_file_id) pair
-- within a transaction (spec §7.2 step 3).
SELECT pg_advisory_xact_lock(
  hashtext('drive_file:' || sqlc.arg('workspace_id')::text || ':' || sqlc.arg('external_file_id')::text)
);

-- name: GetActiveDriveFileByExternalIDForUpdate :one
SELECT *
FROM drive_files
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND external_file_id = sqlc.arg('external_file_id')
  AND unlinked_at IS NULL
FOR UPDATE;

-- name: GetActiveDriveFileByID :one
SELECT *
FROM drive_files
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND unlinked_at IS NULL;

-- name: GetActiveDriveFileByIDForUpdate :one
SELECT *
FROM drive_files
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND unlinked_at IS NULL
FOR UPDATE;

-- name: GetActiveDriveFileByIDForShare :one
SELECT *
FROM drive_files
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND unlinked_at IS NULL
FOR SHARE;

-- name: CreateDriveFile :one
INSERT INTO drive_files (
  id, organization_id, workspace_id, external_file_id, drive_id,
  drive_folder_id, drive_folder_name,
  connection_id, bound_by, created_by, created_by_kind,
  name, mime_type, icon_kind, web_view_link, owner_display,
  drive_modified_at, drive_modified_by_display, sharing_state,
  shared_user_count, metadata_refreshed_at
) VALUES (
  sqlc.arg('id'),
  sqlc.arg('organization_id'),
  sqlc.arg('workspace_id'),
  sqlc.arg('external_file_id'),
  sqlc.narg('drive_id'),
  sqlc.narg('drive_folder_id'),
  sqlc.narg('drive_folder_name'),
  sqlc.arg('connection_id'),
  sqlc.arg('bound_by'),
  sqlc.arg('created_by'),
  sqlc.arg('created_by_kind'),
  sqlc.arg('name'),
  sqlc.arg('mime_type'),
  sqlc.arg('icon_kind'),
  sqlc.arg('web_view_link'),
  sqlc.arg('owner_display'),
  sqlc.narg('drive_modified_at'),
  sqlc.arg('drive_modified_by_display'),
  sqlc.arg('sharing_state'),
  sqlc.narg('shared_user_count'),
  sqlc.narg('metadata_refreshed_at')
)
RETURNING *;

-- name: UpdateDriveFileMetadata :one
UPDATE drive_files
SET drive_id = sqlc.narg('drive_id'),
    drive_folder_id = sqlc.narg('drive_folder_id'),
    drive_folder_name = CASE
      WHEN sqlc.narg('drive_folder_id')::text IS NULL THEN NULL
      WHEN sqlc.narg('drive_folder_name')::text IS NOT NULL THEN sqlc.narg('drive_folder_name')::text
      WHEN drive_files.drive_folder_id IS NOT DISTINCT FROM sqlc.narg('drive_folder_id')::text THEN drive_files.drive_folder_name
      ELSE NULL
    END,
    name = sqlc.arg('name'),
    mime_type = sqlc.arg('mime_type'),
    icon_kind = sqlc.arg('icon_kind'),
    web_view_link = sqlc.arg('web_view_link'),
    owner_display = sqlc.arg('owner_display'),
    drive_modified_at = sqlc.narg('drive_modified_at'),
    drive_modified_by_display = sqlc.arg('drive_modified_by_display'),
    sharing_state = sqlc.arg('sharing_state'),
    shared_user_count = sqlc.narg('shared_user_count'),
    metadata_refreshed_at = sqlc.arg('metadata_refreshed_at'),
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND unlinked_at IS NULL
RETURNING *;

-- name: ClaimDriveFileMetadataRefresh :one
UPDATE drive_files
SET metadata_refreshed_at = now()
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND unlinked_at IS NULL
  AND (
    metadata_refreshed_at IS NULL
    OR metadata_refreshed_at < now() - interval '10 minutes'
  )
RETURNING *;

-- name: RebindDriveFile :one
UPDATE drive_files
SET connection_id = sqlc.arg('connection_id'),
    bound_by = sqlc.arg('bound_by'),
    access_lost_at = NULL,
    drive_id = sqlc.narg('drive_id'),
    drive_folder_id = sqlc.narg('drive_folder_id'),
    drive_folder_name = CASE
      WHEN sqlc.narg('drive_folder_id')::text IS NULL THEN NULL
      WHEN sqlc.narg('drive_folder_name')::text IS NOT NULL THEN sqlc.narg('drive_folder_name')::text
      WHEN drive_files.drive_folder_id IS NOT DISTINCT FROM sqlc.narg('drive_folder_id')::text THEN drive_files.drive_folder_name
      ELSE NULL
    END,
    name = sqlc.arg('name'),
    mime_type = sqlc.arg('mime_type'),
    icon_kind = sqlc.arg('icon_kind'),
    web_view_link = sqlc.arg('web_view_link'),
    owner_display = sqlc.arg('owner_display'),
    drive_modified_at = sqlc.narg('drive_modified_at'),
    drive_modified_by_display = sqlc.arg('drive_modified_by_display'),
    sharing_state = sqlc.arg('sharing_state'),
    shared_user_count = sqlc.narg('shared_user_count'),
    metadata_refreshed_at = sqlc.arg('metadata_refreshed_at'),
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND unlinked_at IS NULL
RETURNING *;

-- name: MarkDriveFileBoundAccessLost :one
UPDATE drive_files
SET access_lost_at = COALESCE(access_lost_at, now()),
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND connection_id = sqlc.arg('connection_id')
  AND unlinked_at IS NULL
  AND access_lost_at IS NULL
RETURNING *;

-- name: ClearDriveFileBoundAccessLost :one
UPDATE drive_files
SET access_lost_at = NULL,
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND connection_id = sqlc.arg('connection_id')
  AND unlinked_at IS NULL
  AND access_lost_at IS NOT NULL
RETURNING *;

-- name: UnlinkDriveFile :one
UPDATE drive_files
SET unlinked_at = now(),
    unlinked_by = sqlc.arg('unlinked_by'),
    unlinked_by_kind = sqlc.arg('unlinked_by_kind'),
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND unlinked_at IS NULL
RETURNING *;

-- name: GetDriveFileAccessByUser :one
SELECT *
FROM drive_file_access
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND drive_file_id = sqlc.arg('drive_file_id')
  AND user_id = sqlc.arg('user_id');

-- name: GetDriveFileAccessByUserForUpdate :one
SELECT *
FROM drive_file_access
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND drive_file_id = sqlc.arg('drive_file_id')
  AND user_id = sqlc.arg('user_id')
FOR UPDATE;

-- name: CreateDriveFileAccess :one
INSERT INTO drive_file_access (
  id, organization_id, workspace_id, drive_file_id, user_id, connection_id, state, granted_at, checked_at
) VALUES (
  sqlc.arg('id'),
  sqlc.arg('organization_id'),
  sqlc.arg('workspace_id'),
  sqlc.arg('drive_file_id'),
  sqlc.arg('user_id'),
  sqlc.arg('connection_id'),
  sqlc.arg('state'),
  now(),
  now()
)
RETURNING *;

-- name: UpsertDriveFileAccessGranted :one
INSERT INTO drive_file_access (
  id, organization_id, workspace_id, drive_file_id, user_id, connection_id, state, granted_at, checked_at
) VALUES (
  sqlc.arg('id'),
  sqlc.arg('organization_id'),
  sqlc.arg('workspace_id'),
  sqlc.arg('drive_file_id'),
  sqlc.arg('user_id'),
  sqlc.arg('connection_id'),
  'granted',
  now(),
  now()
)
ON CONFLICT (drive_file_id, user_id) DO UPDATE
SET connection_id = EXCLUDED.connection_id,
    state = 'granted',
    granted_at = CASE
      WHEN drive_file_access.connection_id <> EXCLUDED.connection_id OR drive_file_access.state <> 'granted'
      THEN now()
      ELSE drive_file_access.granted_at
    END,
    checked_at = now()
WHERE drive_file_access.organization_id = sqlc.arg('organization_id')
  AND drive_file_access.workspace_id = sqlc.arg('workspace_id')
RETURNING *;

-- name: TouchDriveFileAccessCheckedAt :one
UPDATE drive_file_access
SET state = 'granted',
    checked_at = now()
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND drive_file_id = sqlc.arg('drive_file_id')
  AND user_id = sqlc.arg('user_id')
  AND connection_id = sqlc.arg('connection_id')
RETURNING *;

-- name: MarkDriveFileAccessLost :one
UPDATE drive_file_access
SET state = 'lost',
    checked_at = now()
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND drive_file_id = sqlc.arg('drive_file_id')
  AND user_id = sqlc.arg('user_id')
  AND connection_id = sqlc.arg('connection_id')
  AND state <> 'lost'
RETURNING *;

-- name: GetDriveFileEnriched :one
SELECT f.*,
       COALESCE(bc.google_email, '')::text AS bound_account_email,
       (bc.id IS NULL OR bc.disconnected_at IS NOT NULL OR bc.auth_failed_at IS NOT NULL)::boolean AS bound_connection_lost,
       COALESCE(bu.display_name, '')::text AS bound_by_name,
       COALESCE(cu.display_name, '')::text AS created_by_name,
       va.id AS viewer_access_id,
       va.connection_id AS viewer_connection_id,
       va.state AS viewer_access_state,
       COALESCE(vc.google_email, '')::text AS viewer_account_email,
       (vc.id IS NOT NULL AND vc.disconnected_at IS NULL AND vc.auth_failed_at IS NULL)::boolean AS viewer_connection_active
FROM drive_files f
LEFT JOIN drive_connections bc
  ON bc.id = f.connection_id
 AND bc.organization_id = f.organization_id
LEFT JOIN users bu ON bu.id = f.bound_by
LEFT JOIN users cu ON cu.id = f.created_by
LEFT JOIN drive_file_access va
  ON va.drive_file_id = f.id
 AND va.organization_id = f.organization_id
 AND va.workspace_id = f.workspace_id
 AND va.user_id = sqlc.arg('viewer_user_id')
LEFT JOIN drive_connections vc
  ON vc.id = va.connection_id
 AND vc.organization_id = f.organization_id
 AND vc.user_id = va.user_id
WHERE f.id = sqlc.arg('id')
  AND f.organization_id = sqlc.arg('organization_id')
  AND f.workspace_id = sqlc.arg('workspace_id')
  AND f.unlinked_at IS NULL;

-- name: ListMyDriveFilesEnriched :many
SELECT f.*,
       COALESCE(bc.google_email, '')::text AS bound_account_email,
       (bc.id IS NULL OR bc.disconnected_at IS NOT NULL OR bc.auth_failed_at IS NOT NULL)::boolean AS bound_connection_lost,
       COALESCE(bu.display_name, '')::text AS bound_by_name,
       COALESCE(cu.display_name, '')::text AS created_by_name,
       va.id AS viewer_access_id,
       va.connection_id AS viewer_connection_id,
       va.state AS viewer_access_state,
       COALESCE(vc.google_email, '')::text AS viewer_account_email,
       (vc.id IS NOT NULL AND vc.disconnected_at IS NULL AND vc.auth_failed_at IS NULL)::boolean AS viewer_connection_active
FROM drive_file_access va
JOIN drive_files f
  ON f.id = va.drive_file_id
 AND f.organization_id = va.organization_id
 AND f.workspace_id = va.workspace_id
LEFT JOIN drive_connections bc
  ON bc.id = f.connection_id
 AND bc.organization_id = f.organization_id
LEFT JOIN users bu ON bu.id = f.bound_by
LEFT JOIN users cu ON cu.id = f.created_by
LEFT JOIN drive_connections vc
  ON vc.id = va.connection_id
 AND vc.organization_id = f.organization_id
 AND vc.user_id = va.user_id
WHERE va.organization_id = sqlc.arg('organization_id')
  AND va.workspace_id = sqlc.arg('workspace_id')
  AND va.user_id = sqlc.arg('viewer_user_id')
  AND f.unlinked_at IS NULL
  AND (sqlc.narg('connection_id')::text IS NULL OR va.connection_id = sqlc.narg('connection_id'))
  AND (
    sqlc.narg('folder_filter')::text IS NULL
    OR (sqlc.narg('folder_filter') = 'none' AND f.drive_folder_id IS NULL)
    OR (sqlc.narg('folder_filter') <> 'none' AND f.drive_folder_id = sqlc.narg('folder_filter'))
  )
  AND (
    sqlc.narg('cursor_created_at')::timestamptz IS NULL
    OR f.created_at < sqlc.narg('cursor_created_at')::timestamptz
    OR (f.created_at = sqlc.narg('cursor_created_at')::timestamptz AND f.id < sqlc.narg('cursor_id')::text)
  )
ORDER BY f.created_at DESC, f.id DESC
LIMIT sqlc.arg('limit_n');

-- name: CountMyDriveFiles :one
SELECT count(*)::bigint
FROM drive_file_access va
JOIN drive_files f
  ON f.id = va.drive_file_id
 AND f.organization_id = va.organization_id
 AND f.workspace_id = va.workspace_id
WHERE va.organization_id = sqlc.arg('organization_id')
  AND va.workspace_id = sqlc.arg('workspace_id')
  AND va.user_id = sqlc.arg('viewer_user_id')
  AND f.unlinked_at IS NULL
  AND (sqlc.narg('connection_id')::text IS NULL OR va.connection_id = sqlc.narg('connection_id'))
  AND (
    sqlc.narg('folder_filter')::text IS NULL
    OR (sqlc.narg('folder_filter') = 'none' AND f.drive_folder_id IS NULL)
    OR (sqlc.narg('folder_filter') <> 'none' AND f.drive_folder_id = sqlc.narg('folder_filter'))
  );

-- name: CountDriveFilesByUserConnections :many
SELECT va.connection_id, count(*)::bigint AS file_count
FROM drive_file_access va
JOIN drive_files f
  ON f.id = va.drive_file_id
 AND f.organization_id = va.organization_id
 AND f.workspace_id = va.workspace_id
WHERE va.organization_id = sqlc.arg('organization_id')
  AND va.workspace_id = sqlc.arg('workspace_id')
  AND va.user_id = sqlc.arg('user_id')
  AND f.unlinked_at IS NULL
GROUP BY va.connection_id;

-- name: ListTaskDriveFilesEnriched :many
SELECT f.*,
       l.task_id AS linked_task_id,
       l.created_at AS linked_at,
       COALESCE(bc.google_email, '')::text AS bound_account_email,
       (bc.id IS NULL OR bc.disconnected_at IS NOT NULL OR bc.auth_failed_at IS NOT NULL)::boolean AS bound_connection_lost,
       COALESCE(bu.display_name, '')::text AS bound_by_name,
       COALESCE(cu.display_name, '')::text AS created_by_name,
       va.id AS viewer_access_id,
       va.connection_id AS viewer_connection_id,
       va.state AS viewer_access_state,
       COALESCE(vc.google_email, '')::text AS viewer_account_email,
       (vc.id IS NOT NULL AND vc.disconnected_at IS NULL AND vc.auth_failed_at IS NULL)::boolean AS viewer_connection_active
FROM drive_file_task_links l
JOIN drive_files f
  ON f.id = l.drive_file_id
 AND f.organization_id = l.organization_id
 AND f.workspace_id = l.workspace_id
LEFT JOIN drive_connections bc
  ON bc.id = f.connection_id
 AND bc.organization_id = f.organization_id
LEFT JOIN users bu ON bu.id = f.bound_by
LEFT JOIN users cu ON cu.id = f.created_by
LEFT JOIN drive_file_access va
  ON va.drive_file_id = f.id
 AND va.organization_id = f.organization_id
 AND va.workspace_id = f.workspace_id
 AND va.user_id = sqlc.arg('viewer_user_id')
LEFT JOIN drive_connections vc
  ON vc.id = va.connection_id
 AND vc.organization_id = f.organization_id
 AND vc.user_id = va.user_id
WHERE l.organization_id = sqlc.arg('organization_id')
  AND l.workspace_id = sqlc.arg('workspace_id')
  AND l.task_id = sqlc.arg('task_id')
  AND f.unlinked_at IS NULL
ORDER BY l.created_at ASC, l.id ASC;

-- name: CreateDriveFileTaskLink :one
INSERT INTO drive_file_task_links (
  id, organization_id, workspace_id, drive_file_id, task_id, created_by, created_by_kind
) VALUES (
  sqlc.arg('id'),
  sqlc.arg('organization_id'),
  sqlc.arg('workspace_id'),
  sqlc.arg('drive_file_id'),
  sqlc.arg('task_id'),
  sqlc.arg('created_by'),
  sqlc.arg('created_by_kind')
)
ON CONFLICT (task_id, drive_file_id) DO NOTHING
RETURNING *;

-- name: DeleteDriveFileTaskLink :one
DELETE FROM drive_file_task_links
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND task_id = sqlc.arg('task_id')
  AND drive_file_id = sqlc.arg('drive_file_id')
RETURNING *;

-- name: DeleteDriveFileTaskLinksByFile :many
DELETE FROM drive_file_task_links
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND drive_file_id = sqlc.arg('drive_file_id')
RETURNING *;
-- name: DeleteDriveFileTaskLinksByTask :many
DELETE FROM drive_file_task_links
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND task_id = sqlc.arg('task_id')
RETURNING *;

-- name: ListLinkedTasksByDriveFileIDs :many
SELECT l.drive_file_id,
       t.id AS task_id,
       t.number AS task_number,
       t.title AS task_title,
       t.status AS task_status,
       l.created_at AS linked_at
FROM drive_file_task_links l
JOIN tasks t
  ON t.id = l.task_id
 AND t.organization_id = l.organization_id
 AND t.workspace_id = l.workspace_id
 AND t.trashed_at IS NULL
WHERE l.organization_id = sqlc.arg('organization_id')
  AND l.workspace_id = sqlc.arg('workspace_id')
  AND l.drive_file_id = ANY(sqlc.arg('drive_file_ids')::text[])
ORDER BY l.created_at ASC, l.id ASC;

-- name: GetDriveConnectionAnyState :one
SELECT *
FROM drive_connections
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND user_id = sqlc.arg('user_id');

-- name: SetDriveFolderNameInWorkspace :many
UPDATE drive_files
SET drive_folder_name = sqlc.arg('drive_folder_name')::text,
    updated_at = now()
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND drive_folder_id = sqlc.arg('drive_folder_id')::text
  AND unlinked_at IS NULL
RETURNING id;

-- name: GetWorkspaceDriveFolderName :one
SELECT COALESCE(
  (SELECT df.name
   FROM drive_folders df
   WHERE df.organization_id = sqlc.arg('organization_id')
     AND df.workspace_id = sqlc.arg('workspace_id')
     AND df.drive_folder_id = sqlc.arg('drive_folder_id')::text
   LIMIT 1),
  (SELECT f.drive_folder_name
   FROM drive_files f
   WHERE f.organization_id = sqlc.arg('organization_id')
     AND f.workspace_id = sqlc.arg('workspace_id')
     AND f.drive_folder_id = sqlc.arg('drive_folder_id')::text
     AND f.drive_folder_name IS NOT NULL
     AND f.unlinked_at IS NULL
   LIMIT 1),
  ''
)::text AS drive_folder_name;

-- name: UpsertDriveFolder :one
INSERT INTO drive_folders (
  id, organization_id, workspace_id, connection_id,
  drive_folder_id, name, parent_folder_id, refreshed_at,
  created_by, created_by_kind
) VALUES (
  sqlc.arg('id'),
  sqlc.arg('organization_id'),
  sqlc.arg('workspace_id'),
  sqlc.arg('connection_id'),
  sqlc.arg('drive_folder_id'),
  sqlc.arg('name'),
  sqlc.narg('parent_folder_id'),
  sqlc.arg('refreshed_at'),
  sqlc.arg('created_by'),
  sqlc.arg('created_by_kind')
)
ON CONFLICT (workspace_id, drive_folder_id) DO UPDATE
SET connection_id = EXCLUDED.connection_id,
    name = EXCLUDED.name,
    parent_folder_id = EXCLUDED.parent_folder_id,
    refreshed_at = EXCLUDED.refreshed_at,
    updated_at = now()
WHERE drive_folders.organization_id = sqlc.arg('organization_id')
RETURNING *;

-- name: ListWorkspaceDriveFolders :many
SELECT drive_folder_id, name, parent_folder_id
FROM drive_folders
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id');

-- name: ListMyDriveFolders :many
SELECT f.drive_folder_id,
       COALESCE(max(df.name), max(f.drive_folder_name), '')::text AS drive_folder_name,
       COALESCE(max(df.parent_folder_id), '')::text AS parent_folder_id,
       count(*)::bigint AS file_count
FROM drive_file_access va
JOIN drive_files f
  ON f.id = va.drive_file_id
 AND f.organization_id = va.organization_id
 AND f.workspace_id = va.workspace_id
LEFT JOIN drive_folders df
  ON df.workspace_id = f.workspace_id
 AND df.organization_id = f.organization_id
 AND df.drive_folder_id = f.drive_folder_id
WHERE va.organization_id = sqlc.arg('organization_id')
  AND va.workspace_id = sqlc.arg('workspace_id')
  AND va.user_id = sqlc.arg('viewer_user_id')
  AND f.unlinked_at IS NULL
  AND (sqlc.narg('connection_id')::text IS NULL OR va.connection_id = sqlc.narg('connection_id'))
GROUP BY f.drive_folder_id
ORDER BY
  CASE
    WHEN f.drive_folder_id IS NULL THEN 2
    WHEN COALESCE(max(df.name), max(f.drive_folder_name)) IS NULL THEN 1
    ELSE 0
  END ASC,
  lower(COALESCE(max(df.name), max(f.drive_folder_name), '')) ASC,
  COALESCE(f.drive_folder_id, '') ASC;

-- name: ListActiveDriveFileIDsByFolderIDs :many
SELECT id
FROM drive_files
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND drive_folder_id = ANY(sqlc.arg('drive_folder_ids')::text[])
  AND unlinked_at IS NULL
ORDER BY created_at DESC, id DESC
LIMIT 20;

-- name: ListActiveWorkspaceDriveFolderIDs :many
SELECT DISTINCT drive_folder_id::text AS drive_folder_id
FROM drive_files
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND drive_folder_id IS NOT NULL
  AND unlinked_at IS NULL;

-- name: DeleteWorkspaceDriveFoldersByIDs :exec
DELETE FROM drive_folders
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND drive_folder_id = ANY(sqlc.arg('drive_folder_ids')::text[]);
