-- name: InsertChatReport :one
INSERT INTO chat_reports (
  id, organization_id, workspace_id, room_id, message_id, target_user_id,
  reason, details, created_by, created_by_kind
) VALUES (
  sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(workspace_id), sqlc.narg(room_id), sqlc.narg(message_id),
  sqlc.arg(target_user_id), sqlc.arg(reason), sqlc.arg(details), sqlc.arg(created_by), sqlc.arg(created_by_kind)
)
RETURNING *;
