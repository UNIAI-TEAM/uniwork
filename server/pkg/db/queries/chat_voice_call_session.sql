-- name: CreateChatVoiceCallSession :execrows
INSERT INTO chat_voice_call_sessions (
  id, organization_id, room_id, call_id, caller_id, caller_name, call_kind, room_name, video,
  invited_at, accepted_at, participant_ids, invitee_ids, declined_ids
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9,
  $10, sqlc.narg('accepted_at'), $11, $12, $13
)
ON CONFLICT (room_id, call_id) DO NOTHING;

-- name: GetChatVoiceCallSession :one
-- tenant: parent room_id
SELECT * FROM chat_voice_call_sessions
WHERE room_id = $1 AND call_id = $2;

-- name: UpsertChatVoiceCallSession :exec
-- tenant: parent room_id
INSERT INTO chat_voice_call_sessions (
  id, organization_id, room_id, call_id, caller_id, caller_name, call_kind, room_name, video,
  invited_at, accepted_at, participant_ids, invitee_ids, declined_ids
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9,
  $10, sqlc.narg('accepted_at'), $11, $12, $13
)
ON CONFLICT (room_id, call_id) DO UPDATE SET
  caller_name = EXCLUDED.caller_name,
  call_kind = EXCLUDED.call_kind,
  room_name = EXCLUDED.room_name,
  video = EXCLUDED.video,
  accepted_at = COALESCE(chat_voice_call_sessions.accepted_at, EXCLUDED.accepted_at),
  participant_ids = EXCLUDED.participant_ids,
  invitee_ids = EXCLUDED.invitee_ids,
  declined_ids = EXCLUDED.declined_ids;

-- name: AcceptChatVoiceCallSession :exec
-- tenant: parent room_id
UPDATE chat_voice_call_sessions
SET accepted_at = COALESCE(accepted_at, now())
WHERE room_id = $1 AND call_id = $2 AND caller_id <> $3;

-- name: AddChatVoiceCallParticipant :exec
-- tenant: parent room_id
UPDATE chat_voice_call_sessions
SET participant_ids = array_append(participant_ids, sqlc.arg(user_id))
WHERE room_id = sqlc.arg(room_id) AND call_id = sqlc.arg(call_id) AND NOT (sqlc.arg(user_id) = ANY(participant_ids));

-- name: AddChatVoiceCallDeclined :exec
-- tenant: parent room_id
UPDATE chat_voice_call_sessions
SET declined_ids = array_append(declined_ids, sqlc.arg(user_id))
WHERE room_id = sqlc.arg(room_id) AND call_id = sqlc.arg(call_id) AND NOT (sqlc.arg(user_id) = ANY(declined_ids));

-- name: TakeChatVoiceCallSession :one
-- tenant: parent room_id
DELETE FROM chat_voice_call_sessions
WHERE room_id = $1 AND call_id = $2
RETURNING *;

-- name: ListPendingChatVoiceCallSessions :many
SELECT * FROM chat_voice_call_sessions
WHERE organization_id = $1
  AND accepted_at IS NULL
  AND invited_at > $2
  AND caller_id <> $3;

-- name: ListOutgoingChatVoiceCallSessions :many
SELECT * FROM chat_voice_call_sessions
WHERE organization_id = $1
  AND caller_id = $2
  AND invited_at > $3;

-- name: DeleteExpiredChatVoiceCallSessions :exec
-- tenant: system
DELETE FROM chat_voice_call_sessions
WHERE (
  accepted_at IS NOT NULL AND accepted_at < $1
) OR (
  accepted_at IS NULL AND invited_at < $2
);
