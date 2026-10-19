-- name: ListChatCallLogsForMember :many
-- The UniChat calls tab (UNI-1833): the call logs of every room the viewer
-- sees in this workspace's chat sidebar (ChatService.ListChatRooms), newest
-- first. That is this workspace's channels and the organization's DMs and
-- groups the viewer is an active or invited member of; a DM also needs the
-- viewer in its member set, and one with a peer the viewer blocked is left
-- out as the sidebar leaves it out. Archived rooms and deleted logs are not
-- listed. Keyset on (created_at, id) like ListDocumentSourceChatFiles: the
-- `created_at <= cursor` bound is the part idx_chat_messages_org_call_logs
-- can range over. The page is cut before the names are joined, so those
-- joins run for its rows only.
WITH page AS (
  SELECT m.id, m.room_id, m.sender_id, m.metadata, m.created_at, r.kind AS room_kind, r.name AS room_name,
         r.member_set_key
  FROM chat_messages m
  JOIN chat_rooms r ON r.id = m.room_id AND r.organization_id = m.organization_id
  WHERE m.organization_id = sqlc.arg(organization_id)::text
    AND m.kind = 'voice_call_log'
    AND m.deleted_at IS NULL
    AND r.archived_at IS NULL
    AND EXISTS (
      SELECT 1 FROM chat_room_members cm
      WHERE cm.room_id = r.id AND cm.user_id = sqlc.arg(viewer_id)::text
        AND cm.status IN ('invited', 'active'))
    AND (
      (r.kind IN ('workspace', 'channel') AND r.workspace_id = sqlc.arg(workspace_id)::text)
      OR r.kind = 'group'
      OR (r.kind = 'dm'
        AND upper(sqlc.arg(viewer_id)::text) = ANY(string_to_array(upper(COALESCE(r.member_set_key, '')), '|'))
        AND NOT EXISTS (
          SELECT 1 FROM chat_blocks b
          WHERE b.organization_id = sqlc.arg(organization_id)::text
            AND b.blocker_id = sqlc.arg(viewer_id)::text
            AND upper(b.blocked_id) = ANY(string_to_array(upper(r.member_set_key), '|'))))
    )
    AND (sqlc.narg(cursor_at)::timestamptz IS NULL
      OR (m.created_at <= sqlc.narg(cursor_at)::timestamptz
        AND (m.created_at, m.id COLLATE "C") < (sqlc.narg(cursor_at)::timestamptz, sqlc.narg(cursor_id)::text COLLATE "C")))
  ORDER BY m.created_at DESC, m.id COLLATE "C" DESC
  LIMIT sqlc.arg(row_limit)::int
)
SELECT
  p.id::text AS id,
  p.room_id::text AS room_id,
  p.sender_id::text AS sender_id,
  p.metadata AS metadata,
  p.created_at AS created_at,
  p.room_kind::text AS room_kind,
  COALESCE(NULLIF(p.room_name, ''), peer.display_name, '')::text AS room_name,
  COALESCE(peer.id, '')::text AS peer_user_id,
  COALESCE(su.display_name, '')::text AS sender_display_name
FROM page p
LEFT JOIN users su ON su.id = p.sender_id
LEFT JOIN LATERAL (
  -- A DM's peer comes from its member set, as in ListChatRoomsForMember.
  SELECT u.id, u.display_name
  FROM users u
  WHERE p.room_kind = 'dm'
    AND u.id = ANY (string_to_array(p.member_set_key, '|'))
    AND u.id != sqlc.arg(viewer_id)::text
  LIMIT 1
) peer ON true
ORDER BY p.created_at DESC, p.id COLLATE "C" DESC;
