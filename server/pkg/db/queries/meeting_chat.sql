-- name: InsertMeetingChatMessage :one
INSERT INTO meeting_chat_messages (id, meeting_id, participant_id, sender_identity, sender_name, message, sent_at, organization_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: ListMeetingChatMessages :many
SELECT * FROM meeting_chat_messages WHERE meeting_id = $1 ORDER BY sent_at ASC, id ASC LIMIT $2;
