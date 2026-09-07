-- name: ListChatUserNicknamesForOwner :many
SELECT target_user_id, nickname
FROM chat_user_nicknames
WHERE organization_id = $1 AND owner_user_id = $2
ORDER BY updated_at DESC;

-- name: UpsertChatUserNickname :one
INSERT INTO chat_user_nicknames (
  id, organization_id, owner_user_id, target_user_id, nickname, updated_at
)
VALUES ($1, $2, $3, $4, $5, now())
ON CONFLICT (organization_id, owner_user_id, target_user_id)
DO UPDATE SET nickname = EXCLUDED.nickname, updated_at = now()
RETURNING target_user_id, nickname;

-- name: DeleteChatUserNickname :exec
DELETE FROM chat_user_nicknames
WHERE organization_id = $1 AND owner_user_id = $2 AND target_user_id = $3;
