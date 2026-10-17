-- BIGUP S1-b (UNI-1862): queries for file_multipart_uploads.
-- Only FileService / internal/service touches this table.

-- name: InsertFileMultipartUpload :one
INSERT INTO file_multipart_uploads (
    id,
    organization_id,
    workspace_id,
    document_id,
    file_id,
    file_upload_session_id,
    created_by,
    created_by_kind,
    opened_via,
    token_document_id,
    storage_upload_id,
    object_key,
    filename,
    size_bytes,
    part_size,
    total_parts,
    title,
    parent_id,
    visibility,
    probe_head_sha256,
    probe_tail_sha256,
    cd_offset,
    cd_size,
    status,
    expires_at,
    created_at,
    updated_at
) VALUES (
    sqlc.arg(id)::text,
    sqlc.arg(organization_id)::text,
    sqlc.arg(workspace_id)::text,
    sqlc.narg(document_id)::text,
    sqlc.arg(file_id)::text,
    sqlc.arg(file_upload_session_id)::text,
    sqlc.arg(created_by)::text,
    sqlc.arg(created_by_kind)::text,
    sqlc.arg(opened_via)::text,
    sqlc.narg(token_document_id)::text,
    sqlc.arg(storage_upload_id)::text,
    sqlc.arg(object_key)::text,
    sqlc.arg(filename)::text,
    sqlc.arg(size_bytes)::bigint,
    sqlc.arg(part_size)::bigint,
    sqlc.arg(total_parts)::int,
    sqlc.narg(title)::text,
    sqlc.narg(parent_id)::text,
    sqlc.narg(visibility)::text,
    sqlc.arg(probe_head_sha256)::text,
    sqlc.arg(probe_tail_sha256)::text,
    sqlc.narg(cd_offset)::bigint,
    sqlc.narg(cd_size)::bigint,
    'open',
    sqlc.arg(expires_at)::timestamptz,
    sqlc.arg(created_at)::timestamptz,
    sqlc.arg(created_at)::timestamptz
)
RETURNING *;

-- name: GetFileMultipartUploadByID :one
-- tenant: by-id
SELECT *
FROM file_multipart_uploads
WHERE id = $1;

-- name: CountOpenFileMultipartUploadsByActor :one
-- tenant: self
SELECT count(*)
FROM file_multipart_uploads
WHERE created_by = $1
  AND status IN ('open', 'validating');

-- name: LeaseFileMultipartUploadForValidation :one
-- tenant: by-id
UPDATE file_multipart_uploads
SET status = 'validating',
    lease_owner = sqlc.arg(lease_owner)::text,
    lease_expires_at = sqlc.arg(lease_expires_at)::timestamptz,
    updated_at = sqlc.arg(now)::timestamptz
WHERE id = sqlc.arg(id)::text
  AND expires_at > sqlc.arg(now)::timestamptz
  AND (
    status = 'open'
    OR (status = 'validating' AND (lease_expires_at IS NULL OR lease_expires_at <= sqlc.arg(now)::timestamptz))
  )
RETURNING *;

-- name: ReleaseFileMultipartUploadLease :execrows
-- tenant: by-id
UPDATE file_multipart_uploads
SET status = 'open',
    lease_owner = NULL,
    lease_expires_at = NULL,
    updated_at = sqlc.arg(now)::timestamptz
WHERE id = sqlc.arg(id)::text
  AND status = 'validating'
  AND lease_owner = sqlc.arg(lease_owner)::text
  AND expires_at > sqlc.arg(now)::timestamptz;

-- name: CompleteFileMultipartUpload :one
-- tenant: by-id
UPDATE file_multipart_uploads
SET status = 'completed',
    result_document_id = sqlc.narg(result_document_id)::text,
    result_version_upload_id = sqlc.narg(result_version_upload_id)::text,
    lease_owner = NULL,
    lease_expires_at = NULL,
    closed_at = sqlc.arg(closed_at)::timestamptz,
    updated_at = sqlc.arg(closed_at)::timestamptz
WHERE id = sqlc.arg(id)::text
  AND status = 'validating'
  AND lease_owner = sqlc.arg(lease_owner)::text
RETURNING *;

-- name: FailFileMultipartUpload :execrows
-- tenant: by-id
UPDATE file_multipart_uploads
SET status = 'failed',
    failure_code = sqlc.arg(failure_code)::text,
    lease_owner = NULL,
    lease_expires_at = NULL,
    closed_at = sqlc.arg(closed_at)::timestamptz,
    updated_at = sqlc.arg(closed_at)::timestamptz
WHERE id = sqlc.arg(id)::text
  AND status = 'validating'
  AND lease_owner = sqlc.arg(lease_owner)::text;

-- name: AbortFileMultipartUpload :execrows
-- tenant: by-id
UPDATE file_multipart_uploads
SET status = 'aborted',
    lease_owner = NULL,
    lease_expires_at = NULL,
    closed_at = sqlc.arg(closed_at)::timestamptz,
    updated_at = sqlc.arg(closed_at)::timestamptz
WHERE id = sqlc.arg(id)::text
  AND (
    status = 'open'
    OR (status = 'validating' AND (lease_expires_at IS NULL OR lease_expires_at <= sqlc.arg(now)::timestamptz))
  );

-- name: ClaimExpiredFileMultipartUploads :many
-- tenant: system
UPDATE file_multipart_uploads
SET status = 'expired',
    lease_owner = NULL,
    lease_expires_at = NULL,
    closed_at = sqlc.arg(now)::timestamptz,
    updated_at = sqlc.arg(now)::timestamptz
WHERE id IN (
  SELECT file_multipart_uploads.id
  FROM file_multipart_uploads
  WHERE file_multipart_uploads.status IN ('open', 'validating')
    AND file_multipart_uploads.expires_at <= sqlc.arg(now)::timestamptz
    AND (
      file_multipart_uploads.lease_owner IS NULL
      OR file_multipart_uploads.lease_expires_at IS NULL
      OR file_multipart_uploads.lease_expires_at <= sqlc.arg(now)::timestamptz
    )
  ORDER BY file_multipart_uploads.expires_at ASC
  LIMIT sqlc.arg(limit_n)::int
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
