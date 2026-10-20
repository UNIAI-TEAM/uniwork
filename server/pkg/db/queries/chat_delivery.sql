-- name: AdvanceChatRoomMembersDelivered :many
-- Moves the caller's delivered cursor in each named room they are an active
-- member of, forward only and never past now(). A room they are not in, or
-- of another organization, matches no row and is skipped without a trace.
-- updated_at stays: it is indexed (idx_chat_room_members_user_ws), and a
-- cursor is not a membership change, so the update can stay HOT.
UPDATE chat_room_members m
SET last_delivered_at = LEAST(a.up_to, now())
FROM (
  SELECT unnest(sqlc.arg(room_ids)::text[]) AS room_id, unnest(sqlc.arg(up_tos)::timestamptz[]) AS up_to
) a, chat_rooms r
WHERE m.room_id = a.room_id
  AND r.id = m.room_id
  AND m.user_id = sqlc.arg(user_id)
  AND m.organization_id = sqlc.arg(organization_id)
  AND m.status IN ('invited', 'active')
  AND (m.last_delivered_at IS NULL OR m.last_delivered_at < LEAST(a.up_to, now()))
RETURNING m.room_id, r.kind, r.is_default;
