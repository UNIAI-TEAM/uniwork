-- name: AiCreateOfficeHandoff :exec
INSERT INTO ai_office_handoffs (
  id, organization_id, workspace_id, user_id, document_id, proposal_id,
  format, title, request, outline, parts, sources, expires_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
);

-- name: AiGetOfficeHandoff :one
SELECT * FROM ai_office_handoffs
WHERE id = $1 AND organization_id = $2;

-- name: AiAdvanceOfficeHandoff :execrows
-- Binds the conversation and moves to the next part, only while the row still
-- sits at the part the caller read and has not expired.
UPDATE ai_office_handoffs
SET conversation_id = sqlc.arg('conversation_id')::text, next_part = next_part + 1
WHERE id = sqlc.arg('id') AND organization_id = sqlc.arg('organization_id')
  AND next_part = sqlc.arg('next_part')::int
  AND (conversation_id IS NULL OR conversation_id = sqlc.arg('conversation_id')::text)
  AND expires_at > sqlc.arg('now')::timestamptz;

-- name: AiExpiredOfficeHandoffIDs :many
-- tenant: system
-- The sweeper's batch: a maintenance job that spans tenants by design.
SELECT id FROM ai_office_handoffs
WHERE expires_at <= sqlc.arg('now')::timestamptz
ORDER BY expires_at
LIMIT sqlc.arg('batch')::int;

-- name: AiDeleteOfficeHandoffsByIDs :exec
-- tenant: system
-- The sweeper's delete; the ids come from AiExpiredOfficeHandoffIDs.
DELETE FROM ai_office_handoffs WHERE id = ANY(sqlc.arg('ids')::text[]);
