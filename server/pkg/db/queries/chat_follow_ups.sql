-- name: InsertChatMessageFollowUp :one
INSERT INTO chat_message_follow_ups (
  id, organization_id, workspace_id, room_id, message_id, user_id,
  note, due_at, created_by, created_by_kind
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
)
RETURNING *;

-- name: GetChatMessageFollowUpByID :one
SELECT * FROM chat_message_follow_ups
WHERE id = $1 AND workspace_id = $2;

-- name: GetChatMessageFollowUpByUserMessage :one
SELECT * FROM chat_message_follow_ups
WHERE user_id = $1 AND message_id = $2;

-- name: ListChatMessageFollowUpsForUser :many
SELECT
  f.id,
  f.organization_id,
  f.workspace_id,
  f.room_id,
  f.message_id,
  f.user_id,
  f.note,
  f.due_at,
  f.completed_at,
  f.created_by,
  f.created_by_kind,
  f.created_at,
  f.updated_at,
  COALESCE(r.kind, '') AS room_kind,
  COALESCE(r.name, '') AS room_name,
  COALESCE(r.visibility, '') AS room_visibility,
  COALESCE(m.body, '') AS message_body,
  COALESCE(m.kind, '') AS message_kind,
  COALESCE(m.sender_id, '') AS message_sender_id,
  COALESCE(sender.display_name, '') AS message_sender_name,
  COALESCE(peer.display_name, '') AS peer_display_name
FROM chat_message_follow_ups f
LEFT JOIN chat_rooms r ON r.id = f.room_id
LEFT JOIN chat_messages m
  ON m.id = f.message_id
 AND m.deleted_at IS NULL
LEFT JOIN users sender ON sender.id = m.sender_id
LEFT JOIN LATERAL (
  SELECT u.display_name
  FROM chat_room_members mem
  INNER JOIN users u ON u.id = mem.user_id
  WHERE mem.room_id = f.room_id
    AND mem.user_id <> f.user_id
    AND mem.status IN ('invited', 'active')
  ORDER BY mem.created_at, mem.user_id
  LIMIT 1
) peer ON true
WHERE f.workspace_id = $1
  AND f.user_id = $2
  AND ($4::bool OR f.completed_at IS NULL)
ORDER BY
  CASE WHEN f.completed_at IS NULL THEN 0 ELSE 1 END,
  f.due_at ASC NULLS LAST,
  f.created_at DESC
LIMIT $3;

-- name: PatchChatMessageFollowUp :one
UPDATE chat_message_follow_ups
SET
  note = $4,
  due_at = $5,
  updated_at = now()
WHERE id = $1 AND workspace_id = $2 AND user_id = $3
RETURNING *;

-- name: CompleteChatMessageFollowUp :one
UPDATE chat_message_follow_ups
SET completed_at = now(), updated_at = now()
WHERE id = $1 AND workspace_id = $2 AND user_id = $3 AND completed_at IS NULL
RETURNING *;

-- name: ReopenChatMessageFollowUp :one
UPDATE chat_message_follow_ups
SET completed_at = NULL, updated_at = now()
WHERE id = $1 AND workspace_id = $2 AND user_id = $3 AND completed_at IS NOT NULL
RETURNING *;

-- name: DeleteChatMessageFollowUp :exec
DELETE FROM chat_message_follow_ups
WHERE id = $1 AND workspace_id = $2 AND user_id = $3;
