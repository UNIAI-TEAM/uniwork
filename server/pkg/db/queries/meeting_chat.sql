-- name: InsertMeetingChatMessage :one
INSERT INTO meeting_chat_messages (id, meeting_id, participant_id, sender_identity, sender_name, message, sent_at, organization_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: ListMeetingChatMessagesLatest :many
-- tenant: parent meeting_id
-- Newest first; callers reverse the page into reading order (G18).
SELECT * FROM meeting_chat_messages WHERE meeting_id = $1 ORDER BY sent_at DESC, id DESC LIMIT $2;

-- name: ListMeetingChatMessagesBefore :many
-- tenant: parent meeting_id
-- The page older than the cursor row. The plain sent_at bound lets the
-- (meeting_id, sent_at) index start the scan at the cursor.
SELECT * FROM meeting_chat_messages
WHERE meeting_id = sqlc.arg('meeting_id')
  AND sent_at <= sqlc.arg('before_at')::timestamptz
  AND (sent_at, id) < (sqlc.arg('before_at')::timestamptz, sqlc.arg('before_id')::text)
ORDER BY sent_at DESC, id DESC
LIMIT sqlc.arg('row_limit');

-- name: ListMeetingChatMessagesSince :many
-- tenant: parent meeting_id
-- Delta read for the in-room feed: everything sent at or after since, oldest first.
SELECT * FROM meeting_chat_messages
WHERE meeting_id = sqlc.arg('meeting_id') AND sent_at >= sqlc.arg('since')::timestamptz
ORDER BY sent_at ASC, id ASC
LIMIT sqlc.arg('row_limit');
