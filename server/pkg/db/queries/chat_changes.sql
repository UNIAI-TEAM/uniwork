-- The chat change log (migration 9991792654508195_chat_changes, ADR 0039 draft).

-- name: AdvanceChatChangeHead :one
-- Takes the organization's next sequence; the row lock it holds until commit
-- orders the writers.
INSERT INTO chat_change_heads (organization_id, seq)
VALUES (sqlc.arg(organization_id), 1)
ON CONFLICT (organization_id) DO UPDATE SET seq = chat_change_heads.seq + 1, updated_at = now()
RETURNING seq;

-- name: InsertChatChange :exec
INSERT INTO chat_changes (organization_id, seq, room_id, message_id, kind)
VALUES (sqlc.arg(organization_id), sqlc.arg(seq), sqlc.arg(room_id), sqlc.arg(message_id), sqlc.arg(kind));

-- name: TrimChatChanges :exec
DELETE FROM chat_changes
WHERE organization_id = sqlc.arg(organization_id) AND seq <= sqlc.arg(up_to);

-- name: GetChatChangeHead :one
SELECT seq FROM chat_change_heads
WHERE organization_id = sqlc.arg(organization_id);

-- name: OldestChatChangeSeq :one
SELECT COALESCE(MIN(seq), 0)::bigint AS seq FROM chat_changes
WHERE organization_id = sqlc.arg(organization_id);

-- name: ListChatChangesSince :many
SELECT seq, room_id, message_id, kind FROM chat_changes
WHERE organization_id = sqlc.arg(organization_id) AND seq > sqlc.arg(since)
ORDER BY seq
LIMIT sqlc.arg(row_limit);
