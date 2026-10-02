-- name: InsertChatVoiceRecording :one
INSERT INTO chat_voice_recordings (
  id, organization_id, workspace_id, room_id, call_id, egress_id, started_by, file_id
) VALUES ($1, $2, $3, $4, $5, $6, $7, sqlc.narg('file_id'))
RETURNING *;

-- name: GetChatVoiceRecordingByEgressID :one
-- tenant: system
SELECT * FROM chat_voice_recordings WHERE egress_id = $1 ORDER BY started_at DESC LIMIT 1;

-- name: ListChatVoiceRecordingFileHolds :many
-- tenant: system
-- FS-C1 section 6: a live recording row holds its file.
SELECT DISTINCT file_id
FROM chat_voice_recordings
WHERE file_id = ANY($1::text[]);

-- name: GetActiveChatVoiceRecording :one
-- tenant: parent room_id
SELECT * FROM chat_voice_recordings
WHERE room_id = $1 AND call_id = $2 AND status = 'ACTIVE'
ORDER BY started_at DESC
LIMIT 1;

-- name: FinishChatVoiceRecording :one
-- tenant: by-id
UPDATE chat_voice_recordings
SET status = $2,
    file_url = COALESCE(sqlc.narg('file_url'), file_url),
    ended_at = now(),
    call_log_message_id = COALESCE(sqlc.narg('call_log_message_id'), call_log_message_id)
WHERE id = $1 AND status = 'ACTIVE'
RETURNING *;

-- name: FinishChatVoiceRecordingByEgress :one
-- tenant: system
UPDATE chat_voice_recordings
SET status = $2,
    file_url = COALESCE(sqlc.narg('file_url'), file_url),
    ended_at = COALESCE(ended_at, now()),
    call_log_message_id = COALESCE(sqlc.narg('call_log_message_id'), call_log_message_id)
WHERE egress_id = $1 AND status IN ('ACTIVE', 'PROCESSING')
RETURNING *;

-- name: AttachChatVoiceRecordingCallLog :one
-- tenant: parent room_id
UPDATE chat_voice_recordings AS r
SET call_log_message_id = $2
WHERE r.id = (
  SELECT c.id FROM chat_voice_recordings AS c
  WHERE c.room_id = $1 AND c.call_id = $3
  ORDER BY c.started_at DESC
  LIMIT 1
)
RETURNING *;

-- name: ListChatVoiceRecordingsForCall :many
-- tenant: parent room_id
SELECT * FROM chat_voice_recordings
WHERE room_id = $1 AND call_id = $2
ORDER BY started_at DESC;

-- name: GetChatVoiceRecordingByID :one
SELECT * FROM chat_voice_recordings
WHERE id = $1 AND workspace_id = $2 AND room_id = $3;

-- name: ListChatVoiceRecordingsForRoom :many
SELECT * FROM chat_voice_recordings
WHERE workspace_id = $1 AND room_id = $2
ORDER BY started_at DESC
LIMIT $3;
