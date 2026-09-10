-- Chat message ↔ task links and thread↔ (C-13.3 / UNI-509).

-- name: CreateChatMessageLink :one
INSERT INTO chat_message_links (
  id, organization_id, workspace_id, room_id, message_id,
  target_type, target_id, relation, created_by, created_by_kind, created_at
) VALUES (
  $1, $2, $3, $4, $5,
  $6, $7, $8, $9, $10, now()
)
RETURNING *;

-- name: GetChatMessageLink :one
SELECT * FROM chat_message_links
WHERE id = $1 AND workspace_id = $2;

-- name: GetChatMessageLinkByPair :one
SELECT * FROM chat_message_links
WHERE message_id = $1 AND target_type = $2 AND target_id = $3;

-- name: ListChatMessageLinksByMessage :many
SELECT * FROM chat_message_links
WHERE message_id = $1 AND workspace_id = $2
ORDER BY created_at ASC;

-- name: ListChatMessageLinksByMessages :many
SELECT * FROM chat_message_links
WHERE workspace_id = $1
  AND message_id = ANY(sqlc.arg(message_ids)::text[])
ORDER BY created_at ASC;

-- name: DeleteChatMessageLink :execrows
DELETE FROM chat_message_links
WHERE id = $1 AND workspace_id = $2 AND message_id = $3;

-- name: CreateChatThreadTaskLink :one
INSERT INTO chat_thread_task_links (
  id, organization_id, workspace_id, room_id, thread_root_id,
  task_id, direction, created_by, created_by_kind, created_at
) VALUES (
  $1, $2, $3, $4, $5,
  $6, $7, $8, $9, now()
)
RETURNING *;

-- name: GetChatThreadTaskLinkByThread :one
SELECT * FROM chat_thread_task_links
WHERE thread_root_id = $1;

-- name: GetChatThreadTaskLinkByTask :one
SELECT * FROM chat_thread_task_links
WHERE task_id = $1
ORDER BY created_at ASC
LIMIT 1;

-- name: DeleteChatThreadTaskLinkByThread :execrows
DELETE FROM chat_thread_task_links
WHERE thread_root_id = $1 AND workspace_id = $2;

-- name: CreateMirroredChatThreadReply :one
INSERT INTO chat_messages (
  id, room_id, workspace_id, sender_id, sender_kind, kind, body,
  reply_to_message_id, thread_root_id, mirrored_from_comment_id
) VALUES (
  $1, $2, $3, $4, $5, 'text', $6,
  sqlc.arg(reply_to_message_id), sqlc.arg(thread_root_id), sqlc.arg(mirrored_from_comment_id)
)
RETURNING *;

-- name: GetChatMessageByMirroredComment :one
SELECT * FROM chat_messages
WHERE mirrored_from_comment_id = $1 AND deleted_at IS NULL;
