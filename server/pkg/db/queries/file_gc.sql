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
-- Unlocked read of file rows for the dry-run report.
SELECT * FROM files
WHERE id = ANY(sqlc.arg('file_ids')::text[])
ORDER BY id;

-- name: FileGCListSessionsByFileIDs :many
-- Unlocked read of the sessions bound to files, for the dry-run report.
SELECT * FROM file_upload_sessions
WHERE file_id = ANY(sqlc.arg('file_ids')::text[])
ORDER BY file_id;

-- name: FileGCListUnjobbedCandidates :many
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

-- name: FileGCLegacyLocatorFileIDs :many
-- Files whose object key a pre-FileService locator column still names: a
-- consumer that has not moved to file_id reads those bytes by key, so the
-- object is shared and must be held (spec 9.2, plan T5). Exact key match or a
-- URL that ends in the key; joins, not per-file scans.
SELECT DISTINCT f.id FROM files f
JOIN attachments a ON a.object_key = f.object_key
WHERE f.id = ANY(sqlc.arg('file_ids')::text[])
UNION
SELECT DISTINCT f.id FROM files f
JOIN users u ON u.avatar_url IS NOT NULL
  AND right(u.avatar_url, length(f.object_key)) = f.object_key
WHERE f.id = ANY(sqlc.arg('file_ids')::text[])
UNION
SELECT DISTINCT f.id FROM files f
JOIN meeting_recordings r ON r.file_url IS NOT NULL
  AND right(r.file_url, length(f.object_key)) = f.object_key
WHERE f.id = ANY(sqlc.arg('file_ids')::text[])
UNION
SELECT DISTINCT f.id FROM files f
JOIN chat_voice_recordings r ON r.file_url IS NOT NULL
  AND right(r.file_url, length(f.object_key)) = f.object_key
WHERE f.id = ANY(sqlc.arg('file_ids')::text[])
UNION
SELECT DISTINCT f.id FROM files f
JOIN chat_messages m ON m.metadata->>'object_key' = f.object_key
WHERE f.id = ANY(sqlc.arg('file_ids')::text[]);

-- name: FileGCAttachmentRefTenants :many
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
-- chat_voice_recordings.file_id: the row carries its tenant.
SELECT r.file_id, r.organization_id
FROM chat_voice_recordings r
WHERE r.file_id = ANY(sqlc.arg('file_ids')::text[]);

-- name: FileGCMeetingRecordingRefTenants :many
-- meeting_recordings.file_id: the tenant comes from the meeting's workspace.
SELECT r.file_id, w.organization_id
FROM meeting_recordings r
LEFT JOIN meetings m ON m.id = r.meeting_id
LEFT JOIN workspaces w ON w.id = m.workspace_id
WHERE r.file_id = ANY(sqlc.arg('file_ids')::text[]);
