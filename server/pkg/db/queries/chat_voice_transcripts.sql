-- name: GetChatVoiceTranscript :one
SELECT * FROM chat_voice_transcripts
WHERE organization_id = $1 AND message_id = $2;

-- name: ClaimChatVoiceTranscript :one
-- tenant: parent message_id
-- Takes the one paid transcription of a message: a new 'pending' row, or a
-- 'pending' one whose claim went stale (the claimer died mid-call), retaken
-- under a new id so the old claimer's finish no longer matches. No row back
-- means someone else holds the claim or the transcript is done.
INSERT INTO chat_voice_transcripts (
  id, organization_id, workspace_id, message_id, status, claimed_at, created_by, created_by_kind
) VALUES (
  sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(workspace_id), sqlc.arg(message_id), 'pending', now(),
  sqlc.arg(created_by), sqlc.arg(created_by_kind)
)
ON CONFLICT (message_id) DO UPDATE
SET id = EXCLUDED.id, claimed_at = now(), created_by = EXCLUDED.created_by, created_by_kind = EXCLUDED.created_by_kind
WHERE chat_voice_transcripts.status = 'pending'
  AND chat_voice_transcripts.claimed_at < sqlc.arg(stale_before)::timestamptz
  AND chat_voice_transcripts.organization_id = EXCLUDED.organization_id
RETURNING *;

-- name: FinishChatVoiceTranscript :one
UPDATE chat_voice_transcripts
SET text = $3, language = $4, status = 'done'
WHERE id = $1 AND organization_id = $2 AND status = 'pending'
RETURNING *;

-- name: ReleaseChatVoiceTranscriptClaim :exec
DELETE FROM chat_voice_transcripts
WHERE id = $1 AND organization_id = $2 AND status = 'pending';
