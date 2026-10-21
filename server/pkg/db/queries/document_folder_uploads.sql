-- Folder upload batches and their files (UNI-2052).

-- name: InsertDocumentFolderUpload :one
INSERT INTO document_folder_uploads (
  id, organization_id, workspace_id, created_by, created_by_kind, parent_id,
  mode, root_folder_id, root_title, share_with_workspace, file_count, total_bytes,
  folders, expires_at
) VALUES (
  sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(workspace_id), sqlc.arg(created_by),
  sqlc.arg(created_by_kind), sqlc.narg(parent_id), sqlc.arg(mode), sqlc.arg(root_folder_id), sqlc.arg(root_title),
  sqlc.arg(share_with_workspace), sqlc.arg(file_count), sqlc.arg(total_bytes),
  sqlc.arg(folders), sqlc.arg(expires_at)
)
RETURNING *;

-- name: InsertDocumentFolderUploadFiles :execrows
-- tenant: parent batch_id
-- One statement for every file of a plan; the unnests advance together, so
-- ids[i] goes with file_keys[i] and the rest. An empty probe string and a -1
-- offset stand for "no probe" (small files send none); an empty folder id is
-- the workspace root (a files-mode plan with no parent).
INSERT INTO document_folder_upload_files (
  id, file_key, organization_id, workspace_id, batch_id, folder_id, path, filename,
  size_bytes, target_kind, probe_head_sha256, probe_tail_sha256, cd_offset, cd_size
)
SELECT f.id, f.file_key, sqlc.arg(organization_id)::text, sqlc.arg(workspace_id)::text,
       sqlc.arg(batch_id)::text, NULLIF(f.folder_id, ''), f.path, f.filename, f.size_bytes, f.target_kind,
       NULLIF(f.probe_head, ''), NULLIF(f.probe_tail, ''),
       NULLIF(f.cd_offset, -1), NULLIF(f.cd_size, -1)
FROM (
  SELECT
    unnest(sqlc.arg(ids)::text[]) AS id,
    unnest(sqlc.arg(file_keys)::text[]) AS file_key,
    unnest(sqlc.arg(folder_ids)::text[]) AS folder_id,
    unnest(sqlc.arg(paths)::text[]) AS path,
    unnest(sqlc.arg(filenames)::text[]) AS filename,
    unnest(sqlc.arg(sizes)::bigint[]) AS size_bytes,
    unnest(sqlc.arg(target_kinds)::text[]) AS target_kind,
    unnest(sqlc.arg(probe_heads)::text[]) AS probe_head,
    unnest(sqlc.arg(probe_tails)::text[]) AS probe_tail,
    unnest(sqlc.arg(cd_offsets)::bigint[]) AS cd_offset,
    unnest(sqlc.arg(cd_sizes)::bigint[]) AS cd_size
) AS f;

-- name: GetDocumentFolderUpload :one
-- The creator's read: another member of the workspace gets no row.
SELECT * FROM document_folder_uploads
WHERE id = $1 AND organization_id = $2 AND workspace_id = $3
  AND created_by = $4 AND created_by_kind = $5;

-- name: LockDocumentFolderUpload :one
-- The batch row lock COMPLETE, the content route and DELETE take before they
-- change a file of the batch or its status.
SELECT * FROM document_folder_uploads
WHERE id = $1 AND organization_id = $2 AND workspace_id = $3
  AND created_by = $4 AND created_by_kind = $5
FOR UPDATE;

-- name: LockDocumentFolderUploadStatusShared :one
-- The GET mint's shared lock on the batch row: it conflicts with the FOR UPDATE
-- of cancel, COMPLETE and the content route, so a target is never recorded on a
-- batch that a concurrent cancel already closed.
SELECT status FROM document_folder_uploads
WHERE id = $1 AND organization_id = $2 AND workspace_id = $3
FOR SHARE;

-- name: ListDocumentFolderUploadFiles :many
SELECT * FROM document_folder_upload_files
WHERE batch_id = $1 AND organization_id = $2 AND workspace_id = $3
ORDER BY id;

-- name: GetDocumentFolderUploadFileByKey :one
SELECT * FROM document_folder_upload_files
WHERE batch_id = $1 AND file_key = $2 AND organization_id = $3 AND workspace_id = $4;

-- name: LockFolderUploadCreator :exec
-- Serializes the per-creator open-batch count with the insert that follows it,
-- so two concurrent plans cannot both pass the cap.
SELECT pg_advisory_xact_lock(hashtextextended('document-folder-upload:' || sqlc.arg(created_by)::text, 0));

-- name: CountOpenFolderUploadsByCreator :one
-- The cap is per creator across the organization's workspaces, so the
-- workspace is not part of the count; organization_id keeps it in the tenant.
-- An open batch past its expiry no longer counts, whether or not the sweep
-- has reached it yet.
SELECT count(*) FROM document_folder_uploads
WHERE organization_id = $1
  AND created_by = $2 AND created_by_kind = $3
  AND status = 'open' AND expires_at > now();

-- name: SetDocumentFolderUploadFileRef :execrows
-- Records the minted target once: a concurrent mint that lost the race finds
-- the reference already set and releases its own.
UPDATE document_folder_upload_files
SET upload_ref = sqlc.arg(upload_ref), updated_at = now()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND status = 'pending' AND upload_ref IS NULL;

-- name: MarkDocumentFolderUploadFileDone :execrows
UPDATE document_folder_upload_files
SET status = 'done', document_id = sqlc.arg(document_id), error_code = NULL, updated_at = now()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id) AND status = 'pending';

-- name: MarkDocumentFolderUploadFileFailed :execrows
UPDATE document_folder_upload_files
SET status = 'failed', error_code = sqlc.arg(error_code), updated_at = now()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id) AND status = 'pending';

-- name: SetDocumentFolderUploadStatus :execrows
-- Moves an open batch to completed or canceled; a settled batch stays as it is.
UPDATE document_folder_uploads
SET status = sqlc.arg(status), updated_at = now(), finished_at = now()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id) AND status = 'open';

-- name: ExpireOpenFolderUploads :many
-- tenant: system
-- The sweep closes every open batch past its expiry and answers the closed
-- rows so the caller can audit each one and release its pending uploads.
UPDATE document_folder_uploads
SET status = 'expired', updated_at = now(), finished_at = now()
WHERE status = 'open' AND expires_at <= now()
RETURNING *;

-- name: DeleteSettledFolderUploads :execrows
-- tenant: system
-- A settled batch has no use after a week; the documents it created stay.
DELETE FROM document_folder_uploads
WHERE status <> 'open' AND finished_at IS NOT NULL AND finished_at < now() - interval '7 days';

-- name: DeleteOrphanFolderUploadFiles :execrows
-- tenant: system
-- File rows whose batch the settled-batch delete removed.
DELETE FROM document_folder_upload_files f
WHERE NOT EXISTS (SELECT 1 FROM document_folder_uploads b WHERE b.id = f.batch_id);

-- name: SetDocumentFolderUploadFileContent :execrows
-- The server content route records the upload its PUT stored and the ETag it
-- answered. A later PUT of the same pending file replaces both (the caller
-- cancels the upload it replaced); a file whose target is a presigned PUT or
-- a multipart session (a ref without an ETag) is never taken over.
UPDATE document_folder_upload_files
SET upload_ref = sqlc.arg(upload_ref), content_etag = sqlc.arg(content_etag), updated_at = now()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id) AND status = 'pending'
  AND target_kind = 'put' AND (upload_ref IS NULL OR content_etag IS NOT NULL);

-- name: CompleteSettledDocumentFolderUpload :execrows
-- An open batch whose files are all done or failed becomes completed.
UPDATE document_folder_uploads b
SET status = 'completed', updated_at = now(), finished_at = now()
WHERE b.id = sqlc.arg(id) AND b.organization_id = sqlc.arg(organization_id)
  AND b.workspace_id = sqlc.arg(workspace_id) AND b.status = 'open'
  AND NOT EXISTS (
    SELECT 1 FROM document_folder_upload_files f
    WHERE f.batch_id = b.id AND f.organization_id = b.organization_id AND f.status = 'pending'
  );

-- name: ResetDocumentFolderUploadFileRef :execrows
-- COMPLETE drops the upload of a pending file whose bytes did not match the
-- plan or are gone: the file stays pending, the next GET mints a fresh target
-- and upload_attempt keeps the next presigned intent apart from this one.
UPDATE document_folder_upload_files
SET upload_ref = NULL, content_etag = NULL, upload_attempt = upload_attempt + 1, updated_at = now()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id) AND status = 'pending'
  AND upload_ref = sqlc.arg(upload_ref);
