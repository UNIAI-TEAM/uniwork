-- FileService file rows (spec 2026-09-22 section 4.1). Tenant-facing reads
-- always carry an explicit organization predicate - no query in this file
-- matches `organization_id IS NULL` on a tenant path. The identity branch has
-- its own query that proves the NULL tenant and the user grant instead
-- (ADR 0023). Internal worker queries are separate again: they may read and
-- transition a row, but they are never an authorization grant (T1-Q10).

-- name: InsertFile :one
-- Upload intent: locator + filename are fixed at write time; verified content
-- fields stay NULL until MarkFileReady.
INSERT INTO files (
  id, organization_id, storage, bucket, object_key, original_filename, metadata
) VALUES (
  sqlc.arg('id'), sqlc.arg('organization_id'), sqlc.arg('storage'),
  sqlc.arg('bucket'), sqlc.arg('object_key'), sqlc.arg('original_filename'),
  sqlc.arg('metadata')::jsonb
) RETURNING *;

-- name: GetFileByID :one
-- Internal read (worker, service internals). No tenant predicate: callers in
-- internal/service must never use it to answer a tenant request.
SELECT * FROM files WHERE id = sqlc.arg('id');

-- name: GetOrgFile :one
-- Tenant-filtered single read.
SELECT * FROM files
WHERE id = sqlc.arg('id') AND organization_id = sqlc.arg('organization_id');

-- name: ListOrgFilesByIDs :many
-- Tenant-filtered batch resolve for modules holding many file_ids.
SELECT * FROM files
WHERE organization_id = sqlc.arg('organization_id')
  AND id = ANY(sqlc.arg('file_ids')::text[])
ORDER BY id;

-- name: GetAvatarFileForUser :one
-- Identity branch only: the row must carry the NULL tenant AND trace to an
-- upload session staged by this user for purpose user_avatar. (The
-- users.avatar_file_id half of the grant lands with the identity lane's
-- column; this query already covers the upload-session half.)
SELECT f.* FROM files f
WHERE f.id = sqlc.arg('id')
  AND f.organization_id IS NULL
  AND EXISTS (
    SELECT 1 FROM file_upload_sessions s
    WHERE s.file_id = f.id
      AND s.purpose = 'user_avatar'
      AND s.user_id = sqlc.arg('user_id')
  );

-- name: LockFilesInIDOrder :many
-- Lock contract: every multi-row mutation locks file rows first, ordered by
-- id, before touching sessions or jobs (spec 9.5). Pass sorted ids.
SELECT * FROM files
WHERE id = ANY(sqlc.arg('file_ids')::text[])
ORDER BY id
FOR UPDATE;

-- name: MarkFileReady :execrows
-- Pending/processing -> ready with the verified content fields; ready_at is
-- set exactly once (COALESCE keeps the first stamp) and never moves again.
-- ready_at is caller-supplied so the file-age anchor is deterministic.
UPDATE files SET
  status = 'ready',
  content_type = sqlc.arg('content_type'),
  size_bytes = sqlc.arg('size_bytes'),
  checksum_sha256 = sqlc.arg('checksum_sha256'),
  metadata = sqlc.arg('metadata')::jsonb,
  object_version = sqlc.arg('object_version'),
  ready_at = COALESCE(ready_at, sqlc.arg('ready_at')),
  updated_at = now()
WHERE id = sqlc.arg('id') AND status IN ('pending', 'processing');

-- name: MarkFileFailed :execrows
-- Terminal write failure; only a still-open file can fail.
UPDATE files SET
  status = 'failed',
  updated_at = now()
WHERE id = sqlc.arg('id') AND status IN ('pending', 'processing');

-- name: MarkFileDeleting :execrows
-- GC barrier: only a finished file can enter deleting. Zero rows means the
-- file was claimed, already terminal or still open - the worker must stop.
UPDATE files SET
  status = 'deleting',
  updated_at = now()
WHERE id = sqlc.arg('id') AND status IN ('ready', 'failed');

-- name: MarkFileDeleted :execrows
-- Tombstone: only from deleting, after bytes are gone. deleted_at is
-- caller-supplied so reconcile and GC share one clock.
UPDATE files SET
  status = 'deleted',
  deleted_at = sqlc.arg('deleted_at'),
  updated_at = now()
WHERE id = sqlc.arg('id') AND status = 'deleting';

-- name: SetFileChecksum :execrows
-- Late verification backfill: write-once, never overwrite an existing digest.
UPDATE files SET
  checksum_sha256 = sqlc.arg('checksum_sha256'),
  updated_at = now()
WHERE id = sqlc.arg('id') AND checksum_sha256 IS NULL;

-- name: SumOrgReadyFileBytes :one
-- T1-Q9: org quota counts each shared file once, whatever its reference count.
SELECT COALESCE(sum(size_bytes), 0)::bigint AS ready_bytes
FROM files
WHERE organization_id = sqlc.arg('organization_id') AND status = 'ready';

-- name: ListGCFileCandidates :many
-- Internal worker scan (no tenant filter): ready files past the claim/GC age
-- cutoff. Reference and session state are checked per-row under lock by the
-- worker before any transition.
SELECT * FROM files
WHERE status = 'ready' AND ready_at < sqlc.arg('ready_before')
ORDER BY ready_at, id
LIMIT sqlc.arg('limit_n');
