-- name: ListLiveChatDocumentCardTargets :many
-- The live chat cards of one document in an organization, newest first, each
-- with what a refresh frame needs to reach its room (UNI-2012 S1b): the room's
-- kind, default flag and workspace, and for a DM or group the current member
-- user ids (the same set ListChatRoomMemberUserIDs selects). One indexed read
-- (idx_chat_messages_org_document_card) so the consumer stays on the realtime
-- lane. total_cards counts every live card of the document, whatever the limit,
-- so the consumer can log how many a truncated refresh dropped. The organization is the first predicate and the room is joined under
-- the same one, so a card of another organization, or a card whose room row
-- names another, never matches.
SELECT
  m.id AS message_id,
  m.room_id,
  r.kind AS room_kind,
  r.is_default AS room_is_default,
  r.workspace_id AS room_workspace_id,
  COALESCE(mem.user_ids, '{}')::text[] AS member_user_ids,
  COUNT(*) OVER ()::int AS total_cards
FROM chat_messages m
JOIN chat_rooms r ON r.id = m.room_id AND r.organization_id = m.organization_id
LEFT JOIN LATERAL (
  SELECT array_agg(DISTINCT cm.user_id) AS user_ids
  FROM chat_room_members cm
  WHERE cm.room_id = r.id
    AND cm.organization_id = r.organization_id
    AND cm.status IN ('invited', 'active')
    AND r.kind NOT IN ('workspace', 'channel')
) mem ON true
WHERE m.organization_id = sqlc.arg(organization_id)
  AND m.kind = 'document'
  AND m.deleted_at IS NULL
  AND m.metadata->>'document_id' = sqlc.arg(document_id)::text
ORDER BY m.created_at DESC, m.id DESC
LIMIT sqlc.arg(row_limit)::int;

-- name: OrganizationHasLiveChatDocumentCard :one
-- Reports whether any room of the organization still holds a live card for
-- document_id (UNI-2012 S3: the "manager commented" notice goes out only then).
SELECT EXISTS (
  SELECT 1
  FROM chat_messages
  WHERE organization_id = sqlc.arg(organization_id)
    AND kind = 'document'
    AND deleted_at IS NULL
    AND metadata->>'document_id' = sqlc.arg(document_id)::text
) AS found;
