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

-- name: ListReadableChatChangesSince :many
-- The changes after since, up to through (the head read first, so a page never
-- runs past the head it answers with), in rooms the caller could read: rooms it
-- is an invited or active member of, and the live public channels of the
-- workspace. A superset of authorizeRoomRead, which still decides each room;
-- it keeps other people's private activity from filling the page.
SELECT c.seq, c.room_id, c.message_id, c.kind FROM chat_changes c
WHERE c.organization_id = sqlc.arg(organization_id)
  AND c.seq > sqlc.arg(since) AND c.seq <= sqlc.arg(through)
  AND (
    c.room_id IN (
      SELECT m.room_id FROM chat_room_members m
      WHERE m.user_id = sqlc.arg(user_id) AND m.status IN ('invited', 'active')
    )
    OR c.room_id IN (
      SELECT r.id FROM chat_rooms r
      WHERE r.workspace_id = sqlc.arg(workspace_id)::text AND r.kind = 'channel' AND r.visibility = 'public'
        AND r.archived_at IS NULL
    )
  )
ORDER BY c.seq
LIMIT sqlc.arg(row_limit);
