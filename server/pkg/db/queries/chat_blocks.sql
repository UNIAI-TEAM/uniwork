-- name: InsertChatBlock :one
INSERT INTO chat_blocks (id, organization_id, blocker_id, blocked_id)
VALUES ($1, $2, $3, $4)
ON CONFLICT DO NOTHING
RETURNING *;

-- name: GetChatBlock :one
SELECT id, organization_id, blocker_id, blocked_id, created_at FROM chat_blocks
WHERE organization_id = $1 AND blocker_id = $2 AND blocked_id = $3;

-- name: DeleteChatBlock :exec
DELETE FROM chat_blocks
WHERE organization_id = $1 AND blocker_id = $2 AND blocked_id = $3;

-- name: HasChatBlockBetween :one
SELECT EXISTS(
  SELECT 1 FROM chat_blocks
  WHERE organization_id = $1
    AND (
      (blocker_id = $2 AND blocked_id = $3)
      OR (blocker_id = $3 AND blocked_id = $2)
    )
) AS blocked;

-- name: ListChatBlockedPeerIDs :many
SELECT blocked_id FROM chat_blocks
WHERE organization_id = $1 AND blocker_id = $2;
