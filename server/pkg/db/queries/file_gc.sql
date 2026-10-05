-- FileService collector and reconcile system queries (T5, UNI-743; spec
-- 2026-09-22 sections 9.2-9.4). These run across tenants on purpose: the
-- daily sweep is one system job. None of them is an authorization grant, and
-- none decides on its own that a file is garbage - the worker re-checks every
-- ReferenceProvider under the file lock (T1-Q10). The per-source reference
-- queries below return the tenant of every business row that names a file,
-- soft-deleted rows included, so the worker can refuse a cross-tenant
-- reference instead of deleting past it.

-- name: FileGCTryRunLock :one
-- Run lease: a session advisory lock held on one connection for the whole
-- sweep, so a second replica waking on the same schedule skips instead of
-- running the same batches.
SELECT pg_try_advisory_lock(sqlc.arg('lock_key')::bigint) AS locked;

-- name: FileGCRunUnlock :one
SELECT pg_advisory_unlock(sqlc.arg('lock_key')::bigint) AS unlocked;

-- name: FileGCClaimJobs :many
-- tenant: system
-- ClaimFileJobs narrowed to some operations, so the sweep can leave cleanup
-- jobs untouched (not leased, attempt unchanged) while the reference
-- registry cannot cover every column, and still drain reconcile jobs.
UPDATE file_jobs SET
  status = 'leased',
  lease_owner = sqlc.arg('lease_owner'),
  lease_expires_at = sqlc.arg('lease_expires_at'),
  generation = generation + 1,
  updated_at = now()
WHERE id IN (
  SELECT file_jobs.id FROM file_jobs
  WHERE file_jobs.status = 'pending'
    AND file_jobs.operation = ANY(sqlc.arg('operations')::text[])
    AND file_jobs.next_attempt_at <= sqlc.arg('now')
  ORDER BY file_jobs.next_attempt_at, file_jobs.id
  LIMIT sqlc.arg('limit_n')
  FOR UPDATE SKIP LOCKED
)
RETURNING *;

-- name: FileGCListDueJobs :many
-- tenant: system
-- Dry-run view of the jobs a destructive sweep would lease (same predicate as
-- FileGCClaimJobs), read without a lock and paged by id.
SELECT * FROM file_jobs
WHERE status = 'pending'
  AND operation = ANY(sqlc.arg('operations')::text[])
  AND next_attempt_at <= sqlc.arg('now')
  AND id > sqlc.arg('after_id')
ORDER BY id
LIMIT sqlc.arg('limit_n');

-- name: FileGCListFilesByIDs :many
-- tenant: system
-- Unlocked read of file rows for the dry-run report.
SELECT * FROM files
WHERE id = ANY(sqlc.arg('file_ids')::text[])
ORDER BY id;

-- name: FileGCListSessionsByFileIDs :many
-- tenant: system
-- Unlocked read of the sessions bound to files, for the dry-run report.
SELECT * FROM file_upload_sessions
WHERE file_id = ANY(sqlc.arg('file_ids')::text[])
ORDER BY file_id;

-- name: FileGCListUnjobbedCandidates :many
-- tenant: system
-- Ready files past the age cutoff (ready_at + 24h, T1-Q5/T1-Q6) that no live
-- cleanup job covers, paged by id. This finds a file whose last reference
-- went away without a ReleaseInTx; the worker only enqueues a cleanup job for
-- it after the providers report no hold, and that job re-checks under lock.
SELECT f.* FROM files f
WHERE f.status = 'ready'
  AND f.ready_at < sqlc.arg('ready_before')
  AND f.id > sqlc.arg('after_id')
  AND NOT EXISTS (
    SELECT 1 FROM file_jobs j
    WHERE j.file_id = f.id
      AND j.operation = 'cleanup'
      AND j.status IN ('pending', 'leased')
  )
ORDER BY f.id
LIMIT sqlc.arg('limit_n');

-- name: FileGCLegacyManagedLocators :many
-- tenant: system
-- Pre-FileService locator values that look like a FileService key: a
-- consumer that has not moved to file_id and still reads those bytes by key
-- makes the object shared, so the collector must hold it (spec 9.2, plan
-- T5). Run once per sweep, not per batch: each table is scanned once with a
-- cheap filter (managed keys start with v1/orgs/ or v1/users/, legacy keys
-- never do), and the worker matches the few rows it returns against each
-- candidate's key (exact key or a URL ending in it).
SELECT a.object_key::text AS locator FROM attachments a
WHERE a.object_key LIKE 'v1/orgs/%' OR a.object_key LIKE 'v1/users/%'
UNION ALL
SELECT u.avatar_url::text FROM users u
WHERE u.avatar_url LIKE '%v1/orgs/%' OR u.avatar_url LIKE '%v1/users/%'
UNION ALL
SELECT r.file_url::text FROM meeting_recordings r
WHERE r.file_url LIKE '%v1/orgs/%' OR r.file_url LIKE '%v1/users/%'
UNION ALL
SELECT r.file_url::text FROM chat_voice_recordings r
WHERE r.file_url LIKE '%v1/orgs/%' OR r.file_url LIKE '%v1/users/%'
UNION ALL
SELECT (m.metadata->>'object_key')::text FROM chat_messages m
WHERE m.metadata->>'object_key' LIKE 'v1/orgs/%' OR m.metadata->>'object_key' LIKE 'v1/users/%';

-- name: FileGCAttachmentRefTenants :many
-- tenant: system
-- attachments.file_id (task attachment, description image, comment
-- attachment): the row carries its tenant.
SELECT a.file_id, a.organization_id
FROM attachments a
WHERE a.file_id = ANY(sqlc.arg('file_ids')::text[]);

-- name: FileGCUserAvatarRefTenants :many
-- users.avatar_file_id: the identity branch, whose files carry the NULL
-- tenant (ADR 0023). Deleted users included.
SELECT u.avatar_file_id AS file_id, NULL::text AS organization_id
FROM users u
WHERE u.avatar_file_id = ANY(sqlc.arg('file_ids')::text[]);

-- name: FileGCChatMessageRefTenants :many
-- tenant: system
-- chat_messages.file_id: the tenant comes from the room, then the room's
-- workspace, then the message's workspace (the worker takes the first one
-- set); none set is unresolved and holds the file.
SELECT m.file_id,
       r.organization_id AS room_organization_id,
       rw.organization_id AS room_workspace_organization_id,
       mw.organization_id AS message_workspace_organization_id
FROM chat_messages m
LEFT JOIN chat_rooms r ON r.id = m.room_id
LEFT JOIN workspaces rw ON rw.id = r.workspace_id
LEFT JOIN workspaces mw ON mw.id = m.workspace_id
WHERE m.file_id = ANY(sqlc.arg('file_ids')::text[]);

-- name: FileGCChatVoiceRecordingRefTenants :many
-- tenant: system
-- chat_voice_recordings.file_id: the row carries its tenant.
SELECT r.file_id, r.organization_id
FROM chat_voice_recordings r
WHERE r.file_id = ANY(sqlc.arg('file_ids')::text[]);

-- name: FileGCMeetingRecordingRefTenants :many
-- tenant: system
-- meeting_recordings.file_id: the tenant comes from the meeting's workspace.
SELECT r.file_id, w.organization_id
FROM meeting_recordings r
LEFT JOIN meetings m ON m.id = r.meeting_id
LEFT JOIN workspaces w ON w.id = m.workspace_id
WHERE r.file_id = ANY(sqlc.arg('file_ids')::text[]);

-- name: FileGCAuditExportRefTenants :many
-- tenant: system
-- audit_exports.file_id: the row carries its tenant.
SELECT e.file_id, e.organization_id
FROM audit_exports e
WHERE e.file_id = ANY(sqlc.arg('file_ids')::text[]);

-- name: FileGCDocumentVersionRefTenants :many
-- tenant: system
-- document_versions.file_id: the row carries its tenant.
SELECT v.file_id, v.organization_id
FROM document_versions v
WHERE v.file_id = ANY(sqlc.arg('file_ids')::text[]);

-- name: FileGCDocumentAssetRefTenants :many
-- tenant: system
-- document_assets.file_id: the row carries its tenant.
SELECT a.file_id, a.organization_id
FROM document_assets a
WHERE a.file_id = ANY(sqlc.arg('file_ids')::text[]);
