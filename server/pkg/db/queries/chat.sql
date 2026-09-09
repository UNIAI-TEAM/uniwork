-- name: GetWorkspaceChatRoom :one
-- Default workspace channel (migrated from kind=workspace).
SELECT * FROM chat_rooms
WHERE workspace_id = $1 AND is_default = true AND archived_at IS NULL
LIMIT 1;

-- name: GetChatRoomByID :one
SELECT * FROM chat_rooms WHERE id = $1;

-- name: CreateChatRoom :one
INSERT INTO chat_rooms (
  id, kind, workspace_id, organization_id, name, member_set_key, livekit_room_name,
  created_by, created_by_kind, visibility, project_id, topic, is_default, created_at, updated_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7,
  $8, sqlc.arg(created_by_kind), sqlc.arg(visibility), sqlc.narg(project_id), sqlc.arg(topic), sqlc.arg(is_default), now(), now()
) RETURNING *;

-- name: GetActiveChatRoomMember :one
SELECT id, room_id, workspace_id, user_id, role, status, send_restricted, invited_by, joined_at, left_at, last_read_at, created_at, updated_at FROM chat_room_members
WHERE room_id = $1 AND user_id = $2 AND status IN ('invited', 'active')
LIMIT 1;

-- name: InsertChatRoomMember :one
INSERT INTO chat_room_members (
  id, room_id, workspace_id, user_id, role, status, joined_at, created_at, updated_at
) VALUES (
  $1, $2, $3, $4, $5, $6, now(), now(), now()
) RETURNING *;

-- name: ListChatRoomMemberUserIDs :many
SELECT user_id FROM chat_room_members
WHERE room_id = $1 AND status IN ('invited', 'active');

-- name: UpdateChatRoomMemberLastRead :exec
UPDATE chat_room_members
SET last_read_at = $3, updated_at = now()
WHERE room_id = $1 AND user_id = $2 AND status IN ('invited', 'active');

-- name: ListChatMessagesByRoom :many
SELECT
  m.id,
  m.room_id,
  m.workspace_id,
  m.sender_id,
  m.kind,
  m.body,
  m.metadata,
  m.reply_to_message_id,
  m.edited_at,
  m.created_at,
  m.client_msg_id,
  u.display_name AS sender_display_name
FROM chat_messages m
INNER JOIN users u ON u.id = m.sender_id
WHERE m.room_id = $1
  AND m.workspace_id = $2
  AND m.deleted_at IS NULL
  AND (sqlc.narg(before_at)::timestamptz IS NULL OR m.created_at < sqlc.narg(before_at))
ORDER BY m.created_at DESC
LIMIT sqlc.arg(msg_limit);

-- name: CreateChatPollMessage :one
INSERT INTO chat_messages (
  id, room_id, workspace_id, sender_id, kind, body, metadata
) VALUES (
  $1, $2, $3, $4, 'poll', $5, $6
) RETURNING *;

-- name: CreateChatReminderMessage :one
INSERT INTO chat_messages (
  id, room_id, workspace_id, sender_id, kind, body, metadata
) VALUES (
  $1, $2, $3, $4, 'reminder', $5, $6
) RETURNING *;

-- name: CreateChatNoteMessage :one
INSERT INTO chat_messages (
  id, room_id, workspace_id, sender_id, kind, body, metadata
) VALUES (
  $1, $2, $3, $4, 'note', $5, $6
) RETURNING *;

-- name: CreateChatMessage :one
INSERT INTO chat_messages (
  id, room_id, workspace_id, sender_id, sender_kind, kind, body, reply_to_message_id, client_msg_id
) VALUES (
  $1, $2, $3, $4, $5, 'text', $6, $7, sqlc.narg(client_msg_id)
) RETURNING *;

-- name: CreateChatVoiceMessage :one
INSERT INTO chat_messages (
  id, room_id, workspace_id, sender_id, sender_kind, kind, body, metadata, reply_to_message_id, client_msg_id
) VALUES (
  $1, $2, $3, $4, $5, 'voice', '', $6, $7, sqlc.narg(client_msg_id)
) RETURNING *;

-- name: CreateChatFileMessage :one
INSERT INTO chat_messages (
  id, room_id, workspace_id, sender_id, sender_kind, kind, body, metadata, reply_to_message_id, client_msg_id
) VALUES (
  $1, $2, $3, $4, $5, 'file', $6, $7, $8, sqlc.narg(client_msg_id)
) RETURNING *;

-- name: GetChatMessageByClientMsgID :one
SELECT * FROM chat_messages
WHERE room_id = $1
  AND sender_id = $2
  AND client_msg_id = $3
  AND deleted_at IS NULL;

-- name: CreateChatVoiceCallLog :one
INSERT INTO chat_messages (
  id, room_id, workspace_id, sender_id, kind, body, metadata
) VALUES (
  $1, $2, $3, $4, 'voice_call_log', '', $5
) RETURNING *;

-- name: GetChatMessageInRoom :one
SELECT * FROM chat_messages
WHERE id = $1 AND room_id = $2 AND workspace_id = $3 AND deleted_at IS NULL;

-- name: UpdateChatMessageMetadata :one
UPDATE chat_messages
SET metadata = $4
WHERE id = $1 AND room_id = $2 AND workspace_id = $3 AND deleted_at IS NULL
RETURNING *;

-- name: UpdateChatMessageBody :one
UPDATE chat_messages
SET body = $4, edited_at = now()
WHERE id = $1 AND room_id = $2 AND workspace_id = $3 AND sender_id = $5 AND kind = 'text' AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteChatMessage :one
UPDATE chat_messages
SET deleted_at = now()
WHERE id = $1 AND room_id = $2 AND workspace_id = $3 AND sender_id = $4 AND deleted_at IS NULL
RETURNING *;

-- name: GetChatRoomByKindAndMemberSet :one
SELECT * FROM chat_rooms
WHERE organization_id = $1 AND kind = $2 AND member_set_key = $3
LIMIT 1;

-- name: GetLatestChatMessageByRoom :one
SELECT
  m.body,
  m.kind,
  m.sender_id,
  m.created_at,
  u.display_name AS sender_display_name
FROM chat_messages m
INNER JOIN users u ON u.id = m.sender_id
WHERE m.room_id = $1
  AND m.workspace_id = $2
  AND m.deleted_at IS NULL
ORDER BY m.created_at DESC
LIMIT 1;

-- name: ListChatRoomsForMember :many
SELECT
  r.id,
  r.kind,
  r.name,
  r.workspace_id,
  r.member_set_key,
  r.member_permissions,
  r.updated_at,
  COALESCE(
    (
      SELECT COUNT(*)::int
      FROM chat_messages m
      WHERE m.room_id = r.id
        AND m.workspace_id = r.workspace_id
        AND m.deleted_at IS NULL
        AND m.sender_id != sqlc.arg(user_id)
        AND m.created_at > COALESCE(mem.last_read_at, '1970-01-01'::timestamptz)
    ),
    0
  ) AS unread_count,
  COALESCE(last_msg.body, '') AS last_message_body,
  COALESCE(last_msg.kind, '') AS last_message_kind,
  COALESCE(last_msg.sender_id, '') AS last_message_sender_id,
  COALESCE(last_msg.sender_display_name, '') AS last_message_sender_name,
  last_msg.created_at AS last_message_at
FROM chat_rooms r
INNER JOIN chat_room_members mem
  ON mem.room_id = r.id AND mem.user_id = sqlc.arg(user_id)
LEFT JOIN LATERAL (
  SELECT
    m.body,
    m.kind,
    m.sender_id,
    m.created_at,
    u.display_name AS sender_display_name
  FROM chat_messages m
  INNER JOIN users u ON u.id = m.sender_id
  WHERE m.room_id = r.id
    AND m.workspace_id = r.workspace_id
    AND m.deleted_at IS NULL
  ORDER BY m.created_at DESC
  LIMIT 1
) last_msg ON true
WHERE r.organization_id = sqlc.arg(organization_id)
  AND r.kind IN ('dm', 'group')
  AND mem.status IN ('invited', 'active')
  AND (
    r.kind != 'dm'
    OR EXISTS (
      SELECT 1
      FROM chat_messages msg
      WHERE msg.room_id = r.id
        AND msg.deleted_at IS NULL
    )
  )
ORDER BY COALESCE(last_msg.created_at, r.updated_at) DESC;

-- name: ListChatRoomMembers :many
SELECT
  m.user_id,
  m.role,
  m.send_restricted,
  u.email,
  u.display_name
FROM chat_room_members m
INNER JOIN users u ON u.id = m.user_id
WHERE m.room_id = $1 AND m.status IN ('invited', 'active')
ORDER BY m.created_at, m.user_id;

-- name: UpdateChatRoomMemberSendRestricted :exec
UPDATE chat_room_members
SET send_restricted = $3, updated_at = now()
WHERE room_id = $1 AND user_id = $2 AND status IN ('invited', 'active');

-- name: UpdateChatRoomMemberRole :exec
UPDATE chat_room_members
SET role = $3, updated_at = now()
WHERE room_id = $1 AND user_id = $2 AND status IN ('invited', 'active');

-- name: LeaveChatRoomMember :exec
UPDATE chat_room_members
SET status = 'left', left_at = now(), updated_at = now()
WHERE room_id = $1 AND user_id = $2 AND status IN ('invited', 'active');

-- name: TouchChatRoomUpdatedAt :exec
UPDATE chat_rooms SET updated_at = now() WHERE id = $1;

-- name: UpdateChatRoomName :exec
UPDATE chat_rooms SET name = $2, updated_at = now() WHERE id = $1;

-- name: UpdateChatRoomMemberPermissions :exec
UPDATE chat_rooms SET member_permissions = $2, updated_at = now() WHERE id = $1;

-- name: UpdateChatChannel :one
UPDATE chat_rooms
SET
  name = COALESCE(sqlc.narg(name), name),
  topic = COALESCE(sqlc.narg(topic), topic),
  visibility = COALESCE(sqlc.narg(visibility), visibility),
  project_id = CASE
    WHEN sqlc.arg(clear_project)::bool THEN NULL
    WHEN sqlc.narg(project_id)::text IS NOT NULL THEN sqlc.narg(project_id)
    ELSE project_id
  END,
  updated_at = now()
WHERE id = sqlc.arg(id)
  AND kind = 'channel'
  AND archived_at IS NULL
RETURNING *;

-- name: ArchiveChatChannel :one
UPDATE chat_rooms
SET archived_at = now(), archived_by = $2, updated_at = now()
WHERE id = $1 AND kind = 'channel' AND is_default = false AND archived_at IS NULL
RETURNING *;

-- name: UnarchiveChatChannel :one
UPDATE chat_rooms
SET archived_at = NULL, archived_by = NULL, updated_at = now()
WHERE id = $1 AND kind = 'channel' AND archived_at IS NOT NULL
RETURNING *;

-- name: ListChatChannelsMine :many
SELECT
  r.id,
  r.kind,
  r.name,
  r.workspace_id,
  r.visibility,
  r.project_id,
  r.topic,
  r.is_default,
  r.member_permissions,
  r.updated_at,
  COALESCE(
    (
      SELECT COUNT(*)::int
      FROM chat_messages m
      WHERE m.room_id = r.id
        AND m.workspace_id = r.workspace_id
        AND m.deleted_at IS NULL
        AND m.sender_id != sqlc.arg(user_id)
        AND m.created_at > COALESCE(mem.last_read_at, '1970-01-01'::timestamptz)
    ),
    0
  ) AS unread_count,
  -- COALESCE: empty channels have no last_msg row; sqlc maps these as string.
  COALESCE(last_msg.body, '') AS last_message_body,
  COALESCE(last_msg.kind, '') AS last_message_kind,
  COALESCE(last_msg.sender_id, '') AS last_message_sender_id,
  COALESCE(last_msg.sender_display_name, '') AS last_message_sender_name,
  last_msg.created_at AS last_message_at
FROM chat_rooms r
INNER JOIN chat_room_members mem
  ON mem.room_id = r.id AND mem.user_id = sqlc.arg(user_id)
LEFT JOIN LATERAL (
  SELECT
    m.body,
    m.kind,
    m.sender_id,
    m.created_at,
    u.display_name AS sender_display_name
  FROM chat_messages m
  INNER JOIN users u ON u.id = m.sender_id
  WHERE m.room_id = r.id
    AND m.workspace_id = r.workspace_id
    AND m.deleted_at IS NULL
  ORDER BY m.created_at DESC
  LIMIT 1
) last_msg ON true
WHERE r.workspace_id = sqlc.arg(workspace_id)
  AND r.kind = 'channel'
  AND r.archived_at IS NULL
  AND mem.status IN ('invited', 'active')
  AND (sqlc.narg(project_id)::text IS NULL OR r.project_id = sqlc.narg(project_id))
  AND (
    sqlc.narg(search_q)::text IS NULL
    OR r.name ILIKE '%' || sqlc.narg(search_q) || '%'
    OR r.topic ILIKE '%' || sqlc.narg(search_q) || '%'
  )
ORDER BY r.is_default DESC, COALESCE(last_msg.created_at, r.updated_at) DESC;

-- name: ListChatChannelsDiscoverable :many
SELECT
  r.id,
  r.kind,
  r.name,
  r.workspace_id,
  r.visibility,
  r.project_id,
  r.topic,
  r.is_default,
  r.member_permissions,
  r.updated_at,
  0 AS unread_count,
  ''::text AS last_message_body,
  ''::text AS last_message_kind,
  ''::text AS last_message_sender_id,
  ''::text AS last_message_sender_name,
  CAST(NULL AS timestamptz) AS last_message_at
FROM chat_rooms r
WHERE r.workspace_id = sqlc.arg(workspace_id)
  AND r.kind = 'channel'
  AND r.visibility = 'public'
  AND r.archived_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM chat_room_members mem
    WHERE mem.room_id = r.id
      AND mem.user_id = sqlc.arg(user_id)
      AND mem.status IN ('invited', 'active')
  )
  AND (sqlc.narg(project_id)::text IS NULL OR r.project_id = sqlc.narg(project_id))
  AND (
    sqlc.narg(search_q)::text IS NULL
    OR r.name ILIKE '%' || sqlc.narg(search_q) || '%'
    OR r.topic ILIKE '%' || sqlc.narg(search_q) || '%'
  )
ORDER BY r.name ASC;

-- name: ListChatChannelsByProject :many
SELECT
  r.id,
  r.kind,
  r.name,
  r.workspace_id,
  r.visibility,
  r.project_id,
  r.topic,
  r.is_default,
  r.member_permissions,
  r.updated_at,
  0 AS unread_count,
  ''::text AS last_message_body,
  ''::text AS last_message_kind,
  ''::text AS last_message_sender_id,
  ''::text AS last_message_sender_name,
  CAST(NULL AS timestamptz) AS last_message_at
FROM chat_rooms r
WHERE r.workspace_id = sqlc.arg(workspace_id)
  AND r.kind = 'channel'
  AND r.project_id = sqlc.arg(project_id)
  AND r.archived_at IS NULL
  AND (
    r.visibility = 'public'
    OR EXISTS (
      SELECT 1 FROM chat_room_members mem
      WHERE mem.room_id = r.id
        AND mem.user_id = sqlc.arg(user_id)
        AND mem.status IN ('invited', 'active')
    )
  )
ORDER BY r.name ASC;

-- name: ReactivateChatRoomMember :exec
UPDATE chat_room_members
SET status = 'active', joined_at = now(), left_at = NULL, updated_at = now()
WHERE room_id = $1 AND user_id = $2 AND status = 'left';

-- name: SearchChatMessagesByRoom :many
SELECT
  m.id,
  m.room_id,
  m.workspace_id,
  m.sender_id,
  m.kind,
  m.body,
  m.metadata,
  m.reply_to_message_id,
  m.edited_at,
  m.created_at,
  m.client_msg_id,
  u.display_name AS sender_display_name
FROM chat_messages m
INNER JOIN users u ON u.id = m.sender_id
WHERE m.room_id = $1
  AND m.workspace_id = $2
  AND m.deleted_at IS NULL
  AND m.kind = 'text'
  AND m.body ILIKE sqlc.arg(search_pattern) ESCAPE '\'
  AND (sqlc.narg(before_at)::timestamptz IS NULL OR m.created_at < sqlc.narg(before_at))
ORDER BY m.created_at DESC
LIMIT sqlc.arg(result_limit);

-- name: ListChatMessagesAfterInRoom :many
SELECT
  m.id,
  m.room_id,
  m.workspace_id,
  m.sender_id,
  m.kind,
  m.body,
  m.metadata,
  m.reply_to_message_id,
  m.edited_at,
  m.created_at,
  m.client_msg_id,
  u.display_name AS sender_display_name
FROM chat_messages m
INNER JOIN users u ON u.id = m.sender_id
WHERE m.room_id = $1
  AND m.workspace_id = $2
  AND m.deleted_at IS NULL
  AND m.created_at > sqlc.arg(after_at)
ORDER BY m.created_at ASC
LIMIT sqlc.arg(msg_limit);

-- name: ListChatMessagesBeforeOrAtInRoom :many
SELECT
  m.id,
  m.room_id,
  m.workspace_id,
  m.sender_id,
  m.kind,
  m.body,
  m.metadata,
  m.reply_to_message_id,
  m.edited_at,
  m.created_at,
  m.client_msg_id,
  u.display_name AS sender_display_name
FROM chat_messages m
INNER JOIN users u ON u.id = m.sender_id
WHERE m.room_id = $1
  AND m.workspace_id = $2
  AND m.deleted_at IS NULL
  AND m.created_at <= sqlc.arg(before_or_at)
ORDER BY m.created_at DESC
LIMIT sqlc.arg(msg_limit);

