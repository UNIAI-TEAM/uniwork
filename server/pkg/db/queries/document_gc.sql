-- Document retention, auto-versioning and compaction worker queries
-- (C-01 §6.3, §9; G1-04b, UNI-678). The List*For* scans are worker inputs:
-- they run once per tick across tenants, then every mutation that follows
-- carries the tenant pair of the row it found.

-- Archive rows whose 30-day retention ran out, free documents only: an
-- owner-service document's retention is the owner's call through the §13.6
-- seam (the public sweep must never delete what an owner still holds). The
-- service deletes metadata and releases the file references in one
-- transaction; FileService GC owns the bytes (ADR 0024). after_* keysets
-- past the previous batch inside one pass so a row that keeps failing can
-- never pin the sweep on the first page.
-- name: ListDocumentsForPurge :many
-- tenant: system
SELECT id, organization_id, workspace_id, purge_after
FROM documents
WHERE archived_at IS NOT NULL
  AND purge_after IS NOT NULL
  AND purge_after < sqlc.arg(before)
  AND owner_id IS NULL
  AND (sqlc.narg(after_at)::timestamptz IS NULL
       OR (purge_after, id) > (sqlc.narg(after_at), sqlc.narg(after_id)::text))
ORDER BY purge_after, id
LIMIT sqlc.arg(max_rows);

-- File references one document holds: every version that stored its snapshot
-- in FileService, and every asset row. Released inside the delete tx.
-- name: ListDocumentFileIDs :many
SELECT v.file_id FROM document_versions v
WHERE v.organization_id = sqlc.arg(organization_id)
  AND v.workspace_id = sqlc.arg(workspace_id)
  AND v.document_id = sqlc.arg(document_id)
  AND v.file_id IS NOT NULL
UNION
SELECT a.file_id FROM document_assets a
WHERE a.organization_id = sqlc.arg(organization_id)
  AND a.workspace_id = sqlc.arg(workspace_id)
  AND a.document_id = sqlc.arg(document_id);

-- name: DeleteDocumentVersions :exec
DELETE FROM document_versions
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id);

-- name: DeleteDocumentAssets :exec
DELETE FROM document_assets
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id);

-- name: DeleteDocumentShares :exec
DELETE FROM document_shares
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id);

-- name: DeleteDocumentShareLinks :exec
DELETE FROM document_share_links
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id);

-- name: DeleteDocumentAccessLogs :exec
DELETE FROM document_access_logs
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id);

-- name: DeleteDocumentComments :exec
DELETE FROM document_comments
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id);

-- name: DeleteDocumentFavorites :exec
DELETE FROM document_favorites
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id);

-- The row delete refuses a document that lost its archive while the sweep
-- was in flight: zero rows means skip.
-- name: DeleteArchivedDocument :execrows
DELETE FROM documents
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND archived_at IS NOT NULL;

-- Orphaned assets on a live document, past the 7-day grace. The scan skips
-- archived documents: they purge whole with their rows. after_* keysets
-- past the previous batch inside one pass.
-- name: ListOrphanedDocumentAssets :many
-- tenant: system
SELECT a.id, a.organization_id, a.workspace_id, a.document_id, a.orphaned_at
FROM document_assets a
JOIN documents d
  ON d.organization_id = a.organization_id
 AND d.workspace_id = a.workspace_id
 AND d.id = a.document_id
WHERE a.orphaned_at IS NOT NULL
  AND a.orphaned_at < sqlc.arg(before)
  AND d.archived_at IS NULL
  AND (sqlc.narg(after_at)::timestamptz IS NULL
       OR (a.orphaned_at, a.id) > (sqlc.narg(after_at), sqlc.narg(after_id)::text))
ORDER BY a.orphaned_at, a.id
LIMIT sqlc.arg(max_rows);

-- An asset row is only deletable when no retained version still references
-- it: a restore of an old version brings its asset:// links back.
-- name: DocumentAssetHeldByVersion :one
SELECT EXISTS (
  SELECT 1 FROM document_versions v
  WHERE v.organization_id = sqlc.arg(organization_id)
    AND v.workspace_id = sqlc.arg(workspace_id)
    AND v.document_id = sqlc.arg(document_id)
    AND v.kind = 'page'
    AND v.content IS NOT NULL
    AND strpos(v.content::text, 'asset://' || sqlc.arg(asset_id)) > 0
) AS held;

-- The orphaned_at bound is restated in the delete itself: an asset orphaned
-- anew inside the grace window survives even when its scan row carried a
-- stale timestamp.
-- name: DeleteDocumentAsset :execrows
DELETE FROM document_assets
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND orphaned_at IS NOT NULL
  AND orphaned_at < sqlc.arg(orphaned_before);

-- Quiet-page scan for the auto-version worker: a page whose content was
-- saved more than the quiet window ago and newer than its last versioned
-- save. last_version_at is the idempotency marker - once a snapshot covers
-- content_saved_at the row drops out of the scan. after_* keysets past the
-- previous batch inside one pass so a page that keeps failing cannot pin
-- the sweep on the first page.
-- name: ListDocumentsForAutoVersion :many
-- tenant: system
SELECT id, organization_id, workspace_id, content_saved_at
FROM documents
WHERE kind = 'page'
  AND archived_at IS NULL
  AND content_saved_at IS NOT NULL
  AND content_saved_at < sqlc.arg(quiet_before)
  AND (last_version_at IS NULL OR last_version_at < content_saved_at)
  AND (sqlc.narg(after_at)::timestamptz IS NULL
       OR (content_saved_at, id) > (sqlc.narg(after_at), sqlc.narg(after_id)::text))
ORDER BY content_saved_at, id
LIMIT sqlc.arg(max_rows);

-- The auto-version write re-checks every predicate under the row lock, so a
-- save that raced the scan is answered by the next tick instead.
-- name: MarkDocumentAutoVersioned :one
UPDATE documents
SET current_version = sqlc.arg(current_version),
    last_version_at = content_saved_at
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND kind = 'page'
  AND archived_at IS NULL
  AND current_version = sqlc.arg(expected_version)
  AND content_saved_at IS NOT NULL
  AND content_saved_at < sqlc.arg(quiet_before)
  AND (last_version_at IS NULL OR last_version_at < content_saved_at)
RETURNING *;

-- Compaction scan: documents whose version count passed the keep bound.
-- after_id keysets past the previous batch inside one pass so a document
-- that cannot be compacted (protected overflow) never pins the sweep.
-- name: ListDocumentsOverVersionLimit :many
-- tenant: system
SELECT document_id, organization_id, workspace_id, count(*) AS total
FROM document_versions
WHERE sqlc.narg(after_id)::text IS NULL
   OR document_id > sqlc.narg(after_id)
GROUP BY organization_id, workspace_id, document_id
HAVING count(*) > sqlc.arg(keep)
ORDER BY document_id
LIMIT sqlc.arg(max_rows);

-- name: CountDocumentVersions :one
SELECT count(*) AS total
FROM document_versions
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id);

-- Protected versions are everything that is not an automatic snapshot:
-- manual milestones, restore points and upload versions survive compaction.
-- name: CountDocumentVersionsProtected :one
SELECT count(*) AS protected
FROM document_versions
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND reason <> 'auto';

-- The version number of the newest auto snapshot that must still be dropped:
-- the (keep+1)-th newest auto is the boundary, autos below it go.
-- name: DocumentAutoVersionKeepBoundary :one
SELECT version
FROM document_versions
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND reason = 'auto'
ORDER BY version DESC
LIMIT 1 OFFSET sqlc.arg(boundary_offset);

-- current_version is never dropped: when protected rows alone reach the
-- bound the keep count is zero and the document's live version is the one
-- row compaction must leave standing.
-- name: DeleteDocumentAutoVersionsBelow :many
DELETE FROM document_versions
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND reason = 'auto'
  AND version <= sqlc.arg(boundary_version)
  AND version <> sqlc.arg(current_version)
RETURNING file_id;
