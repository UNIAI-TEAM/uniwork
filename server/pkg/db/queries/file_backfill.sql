-- FileService backfill (T9b, UNI-747): queries for the files-backfill
-- command. These are internal tooling statements — keyset-ordered scans of
-- legacy locator columns plus the joins the mapping rules (inventory spec
-- section 9) use as their verified tenant source. They are never
-- tenant-serving reads; the tenant predicates exist to verify, not to scope.

-- ---------------------------------------------------------------------------
-- Cohort scans (plan / dry-run / apply / verify share them)
-- ---------------------------------------------------------------------------

-- name: FileBackfillScanAttachments :many
-- M1/M2: object_key is the locator; object_url is only a hint. The row's own
-- organization_id is the verified tenant and the workspaces join is the key
-- cross-check (workspaces/<ws>/attachments/<id>/<name>).
SELECT a.id, a.organization_id, a.workspace_id,
       w.organization_id AS workspace_organization_id,
       a.task_id, a.comment_id, a.uploader_type, a.uploader_id,
       a.object_key, a.object_url, a.filename, a.content_type, a.size_bytes,
       a.expires_at, a.file_id, a.purpose, a.created_at
FROM attachments a
LEFT JOIN workspaces w ON w.id = a.workspace_id
WHERE a.id > sqlc.arg('after_id')
ORDER BY a.id
LIMIT sqlc.arg('limit_n');

-- name: FileBackfillScanAvatars :many
-- M8/M9: the account avatar is the identity-scope exception; external URLs
-- (Google pictures, foreign CDNs) are classified in code, never imported.
SELECT id, avatar_url, avatar_file_id, created_at
FROM users
WHERE id > sqlc.arg('after_id')
  AND avatar_url IS NOT NULL AND avatar_url <> ''
ORDER BY id
LIMIT sqlc.arg('limit_n');

-- name: FileBackfillScanChatMessages :many
-- M3/M4 (kind file/voice: object_key in metadata) and M7 (voice_call_log:
-- recording_url in metadata — a second reference to a call-recording object).
-- Tenant derives through the room; chat_rooms.organization_id may be NULL.
SELECT m.id, m.room_id, m.workspace_id, m.sender_id, m.sender_kind, m.kind,
       m.metadata, m.deleted_at, m.file_id, m.created_at,
       r.organization_id AS room_organization_id,
       r.workspace_id    AS room_workspace_id
FROM chat_messages m
LEFT JOIN chat_rooms r ON r.id = m.room_id
WHERE m.id > sqlc.arg('after_id')
  AND m.kind IN ('file', 'voice', 'voice_call_log')
ORDER BY m.id
LIMIT sqlc.arg('limit_n');

-- name: FileBackfillScanMeetingRecordings :many
-- M5: file_url is the locator; the tenant derives meetings -> workspaces.
SELECT r.id, r.meeting_id, r.status, r.file_url, r.file_id, r.started_by, r.started_at,
       m.workspace_id  AS meeting_workspace_id,
       w.organization_id AS meeting_organization_id
FROM meeting_recordings r
LEFT JOIN meetings m ON m.id = r.meeting_id
LEFT JOIN workspaces w ON w.id = m.workspace_id
WHERE r.id > sqlc.arg('after_id')
  AND r.file_url IS NOT NULL AND r.file_url <> ''
ORDER BY r.id
LIMIT sqlc.arg('limit_n');

-- name: FileBackfillScanCallRecordings :many
-- M6: file_url is the locator; organization_id is on the row.
SELECT id, organization_id, workspace_id, room_id, call_id, egress_id, status,
       file_url, file_id, call_log_message_id, started_by, started_at
FROM chat_voice_recordings
WHERE id > sqlc.arg('after_id')
  AND file_url IS NOT NULL AND file_url <> ''
ORDER BY id
LIMIT sqlc.arg('limit_n');

-- name: FileBackfillScanAuditExports :many
-- M12: object_key is the locator; organization_id is on the row.
SELECT id, organization_id, requested_by, requested_by_kind, format,
       object_key, file_id, expires_at, created_at
FROM audit_exports
WHERE id > sqlc.arg('after_id')
  AND object_key IS NOT NULL AND object_key <> ''
ORDER BY id
LIMIT sqlc.arg('limit_n');

-- ---------------------------------------------------------------------------
-- M11 content scans: /api/v1/attachments/<id>/... references embedded in
-- task descriptions, comment bodies and source-context snapshots. They never
-- create files; they are reference evidence for the report and verify.
-- ---------------------------------------------------------------------------

-- name: FileBackfillScanTaskDescriptionRefs :many
SELECT id, organization_id, workspace_id, description AS content
FROM tasks
WHERE id > sqlc.arg('after_id') AND description LIKE '%/attachments/%'
ORDER BY id
LIMIT sqlc.arg('limit_n');

-- name: FileBackfillScanCommentRefs :many
SELECT id, organization_id, workspace_id, body AS content
FROM task_comments
WHERE id > sqlc.arg('after_id') AND body LIKE '%/attachments/%'
ORDER BY id
LIMIT sqlc.arg('limit_n');

-- name: FileBackfillScanSourceContextRefs :many
SELECT id, organization_id, workspace_id, snapshot::text AS content
FROM task_source_contexts
WHERE id > sqlc.arg('after_id') AND snapshot::text LIKE '%/attachments/%'
ORDER BY id
LIMIT sqlc.arg('limit_n');

-- ---------------------------------------------------------------------------
-- files / sessions
-- ---------------------------------------------------------------------------

-- name: FileBackfillGetFileByLocator :one
-- The locator identity matches uidx_files_locator (storage, coalesce(bucket,
-- ''), object_key) and must see tombstones too: a deleted file keeps the
-- locator claimed forever, so a tombstone hit is reported, not reused.
SELECT * FROM files
WHERE storage = sqlc.arg('storage')
  AND object_key = sqlc.arg('object_key')
  AND bucket IS NOT DISTINCT FROM sqlc.narg('bucket');

-- name: FileBackfillGetFileByID :one
-- verify reads the row a business file_id points at.
SELECT * FROM files WHERE id = sqlc.arg('id');

-- name: FileBackfillListSessionsForFile :many
-- verify checks scope/purpose coverage; rollback checks remaining claims.
SELECT * FROM file_upload_sessions
WHERE file_id = sqlc.arg('file_id')
ORDER BY id;

-- name: FileBackfillInsertFile :one
-- Get-or-create by locator: a second inserter loses the race silently and
-- re-reads through FileBackfillGetFileByLocator, so a replayed run can never
-- mint a second row for one object.
INSERT INTO files (
  id, organization_id, storage, bucket, object_key, original_filename, metadata
) VALUES (
  sqlc.arg('id'), sqlc.narg('organization_id'), sqlc.arg('storage'),
  sqlc.narg('bucket'), sqlc.arg('object_key'), sqlc.arg('original_filename'),
  sqlc.arg('metadata')::jsonb
)
ON CONFLICT DO NOTHING
RETURNING *;

-- name: FileBackfillMarkFileReady :execrows
-- Backfill's MarkFileReady: the row this command inserts starts pending and
-- is readied with the object-verified fields in the same transaction.
UPDATE files SET
  status = 'ready',
  content_type = sqlc.arg('content_type'),
  size_bytes = sqlc.arg('size_bytes'),
  checksum_sha256 = sqlc.narg('checksum_sha256'),
  object_version = sqlc.narg('object_version'),
  ready_at = COALESCE(ready_at, sqlc.arg('ready_at')),
  updated_at = now()
WHERE id = sqlc.arg('id') AND status IN ('pending', 'processing');

-- name: FileBackfillInsertSession :one
-- One session per file, already claimed: the business reference existed
-- before FileService did, so the session is born terminal (the historical
-- upload's receipt), which is what ResolveMany/Open scope checks read.
INSERT INTO file_upload_sessions (
  id, file_id, created_by, created_by_kind, purpose,
  organization_id, workspace_id, user_id,
  idempotency_key, command_fingerprint,
  status, claim_expires_at, closed_at
) VALUES (
  sqlc.arg('id'), sqlc.arg('file_id'), sqlc.arg('created_by'),
  sqlc.arg('created_by_kind'), sqlc.arg('purpose'),
  sqlc.narg('organization_id'), sqlc.narg('workspace_id'), sqlc.narg('user_id'),
  sqlc.arg('idempotency_key'), sqlc.arg('command_fingerprint'),
  sqlc.arg('status'), sqlc.arg('claim_expires_at'), sqlc.narg('closed_at')
)
ON CONFLICT DO NOTHING
RETURNING *;

-- ---------------------------------------------------------------------------
-- Business-row reference writes: every one is guarded by `file_id IS NULL`
-- (avatars: avatar_file_id), so a replayed apply is a no-op and a row that
-- raced to a different value reports zero rows instead of being overwritten.
-- ---------------------------------------------------------------------------

-- name: FileBackfillSetAttachmentFile :execrows
UPDATE attachments
SET file_id = sqlc.arg('file_id'), purpose = sqlc.arg('purpose'), updated_at = now()
WHERE id = sqlc.arg('id') AND file_id IS NULL;

-- name: FileBackfillSetUserAvatarFile :execrows
-- avatar_url is deliberately kept: the migration window leaves it as the
-- display fallback until the reader fleet resolves avatar_file_id, and the
-- previous URL is preserved on the item row for rollback.
UPDATE users
SET avatar_file_id = sqlc.arg('file_id'), updated_at = now()
WHERE id = sqlc.arg('id') AND avatar_file_id IS NULL;

-- name: FileBackfillSetChatMessageFile :execrows
-- The column is authoritative; metadata carries the same id the FS writer
-- would have written, while the legacy object_key entry stays in place.
UPDATE chat_messages
SET file_id = sqlc.arg('file_id'),
    metadata = metadata || jsonb_build_object('file_id', sqlc.arg('file_id')::text)
WHERE id = sqlc.arg('id') AND file_id IS NULL;

-- name: FileBackfillSetMeetingRecordingFile :execrows
UPDATE meeting_recordings
SET file_id = sqlc.arg('file_id')
WHERE id = sqlc.arg('id') AND file_id IS NULL;

-- name: FileBackfillSetCallRecordingFile :execrows
UPDATE chat_voice_recordings
SET file_id = sqlc.arg('file_id')
WHERE id = sqlc.arg('id') AND file_id IS NULL;

-- name: FileBackfillSetAuditExportFile :execrows
UPDATE audit_exports
SET file_id = sqlc.arg('file_id')
WHERE id = sqlc.arg('id') AND file_id IS NULL;

-- ---------------------------------------------------------------------------
-- Run ledger, checkpoints and per-item outcomes
-- ---------------------------------------------------------------------------

-- name: FileBackfillCreateRun :one
INSERT INTO file_backfill_runs (id, command, config)
VALUES (sqlc.arg('id'), sqlc.arg('command'), sqlc.arg('config')::jsonb)
RETURNING *;

-- name: FileBackfillGetRun :one
SELECT * FROM file_backfill_runs WHERE id = sqlc.arg('id');

-- name: FileBackfillFinishRun :exec
UPDATE file_backfill_runs
SET status = sqlc.arg('status'), finished_at = now(), updated_at = now()
WHERE id = sqlc.arg('id');

-- name: FileBackfillPutCheckpoint :exec
INSERT INTO file_backfill_checkpoints (run_id, cohort, cursor, seen, applied, skipped, held)
VALUES (
  sqlc.arg('run_id'), sqlc.arg('cohort'), sqlc.arg('cursor'),
  sqlc.arg('seen'), sqlc.arg('applied'), sqlc.arg('skipped'), sqlc.arg('held')
)
ON CONFLICT (run_id, cohort) DO UPDATE SET
  cursor = EXCLUDED.cursor, seen = EXCLUDED.seen, applied = EXCLUDED.applied,
  skipped = EXCLUDED.skipped, held = EXCLUDED.held, updated_at = now();

-- name: FileBackfillListCheckpoints :many
SELECT * FROM file_backfill_checkpoints
WHERE run_id = sqlc.arg('run_id')
ORDER BY cohort;

-- name: FileBackfillPutItem :exec
INSERT INTO file_backfill_items (
  run_id, cohort, source_table, source_id, file_id,
  storage, bucket, object_key, object_version, organization_id,
  status, reason, previous_locator, details
) VALUES (
  sqlc.arg('run_id'), sqlc.arg('cohort'), sqlc.arg('source_table'), sqlc.arg('source_id'),
  sqlc.narg('file_id'), sqlc.narg('storage'), sqlc.narg('bucket'),
  sqlc.narg('object_key'), sqlc.narg('object_version'), sqlc.narg('organization_id'),
  sqlc.arg('status'), sqlc.arg('reason'), sqlc.narg('previous_locator'),
  sqlc.arg('details')::jsonb
)
ON CONFLICT (run_id, cohort, source_table, source_id) DO UPDATE SET
  file_id = EXCLUDED.file_id, storage = EXCLUDED.storage, bucket = EXCLUDED.bucket,
  object_key = EXCLUDED.object_key, object_version = EXCLUDED.object_version,
  organization_id = EXCLUDED.organization_id, status = EXCLUDED.status,
  reason = EXCLUDED.reason, previous_locator = EXCLUDED.previous_locator,
  details = EXCLUDED.details, updated_at = now();

-- name: FileBackfillListRunItems :many
SELECT * FROM file_backfill_items
WHERE run_id = sqlc.arg('run_id')
ORDER BY cohort, source_table, source_id;

-- name: FileBackfillListDoneItemKeys :many
-- The resume index: committed item rows mean the business write committed,
-- so a resumed run skips exactly the work that already landed.
SELECT source_table, source_id FROM file_backfill_items
WHERE run_id = sqlc.arg('run_id');

-- name: FileBackfillListRunItemsByStatus :many
SELECT * FROM file_backfill_items
WHERE run_id = sqlc.arg('run_id') AND status = sqlc.arg('status')
ORDER BY cohort, source_table, source_id;

-- ---------------------------------------------------------------------------
-- Rollback (pre-cutover recovery): revert business references to their as-was
-- state and remove the rows this command created. Guarded by the file_id the
-- run recorded, so a row that moved on is never rewritten. Objects are never
-- touched — legacy locators still name them.
-- ---------------------------------------------------------------------------

-- name: FileBackfillClearAttachmentFile :execrows
UPDATE attachments SET file_id = NULL, purpose = NULL, updated_at = now()
WHERE id = sqlc.arg('id') AND file_id IS NOT DISTINCT FROM sqlc.narg('file_id');

-- name: FileBackfillClearUserAvatarFile :execrows
UPDATE users SET avatar_file_id = NULL, updated_at = now()
WHERE id = sqlc.arg('id') AND avatar_file_id IS NOT DISTINCT FROM sqlc.narg('file_id');

-- name: FileBackfillClearChatMessageFile :execrows
UPDATE chat_messages
SET file_id = NULL, metadata = metadata - 'file_id'
WHERE id = sqlc.arg('id') AND file_id IS NOT DISTINCT FROM sqlc.narg('file_id');

-- name: FileBackfillClearMeetingRecordingFile :execrows
UPDATE meeting_recordings SET file_id = NULL
WHERE id = sqlc.arg('id') AND file_id IS NOT DISTINCT FROM sqlc.narg('file_id');

-- name: FileBackfillClearCallRecordingFile :execrows
UPDATE chat_voice_recordings SET file_id = NULL
WHERE id = sqlc.arg('id') AND file_id IS NOT DISTINCT FROM sqlc.narg('file_id');

-- name: FileBackfillClearAuditExportFile :execrows
UPDATE audit_exports SET file_id = NULL
WHERE id = sqlc.arg('id') AND file_id IS NOT DISTINCT FROM sqlc.narg('file_id');

-- name: FileBackfillDeleteSession :exec
DELETE FROM file_upload_sessions WHERE id = sqlc.arg('id') AND file_id = sqlc.arg('file_id');

-- name: FileBackfillDeleteSessionsForFile :exec
DELETE FROM file_upload_sessions WHERE file_id = sqlc.arg('file_id');

-- name: FileBackfillDeleteFile :execrows
-- Physical delete, not a tombstone: the file never owned the object, so the
-- row must not pin the locator in uidx_files_locator against a re-run.
DELETE FROM files WHERE id = sqlc.arg('id') AND status IN ('pending', 'ready', 'failed');

-- name: FileBackfillRestoreFileState :execrows
-- Undo an adopted row's ready-marking on rollback: the as-was state the run
-- snapshot into the item's details is written back. Guarded to rows still
-- 'ready' — a file that moved on since apply is never rewound.
UPDATE files SET
  status = sqlc.arg('status'),
  content_type = sqlc.narg('content_type'),
  size_bytes = sqlc.narg('size_bytes'),
  checksum_sha256 = sqlc.narg('checksum_sha256'),
  object_version = sqlc.narg('object_version'),
  ready_at = NULL,
  updated_at = now()
WHERE id = sqlc.arg('id') AND status = 'ready';
