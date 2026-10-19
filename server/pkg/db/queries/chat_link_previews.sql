-- Link previews (UNI-1908 F3, ADR 0035): the organization's cache of page
-- cards and which one each message shows.

-- name: GetChatMessageForLinkPreview :one
-- The message a chat.link_preview.requested row names, in the organization
-- the row was written for.
SELECT id, room_id, body, deleted_at FROM chat_messages
WHERE id = sqlc.arg('id')
  AND room_id = sqlc.arg('room_id')
  AND organization_id = sqlc.arg('organization_id');

-- name: GetChatLinkPreviewByURL :one
SELECT * FROM chat_link_previews
WHERE organization_id = sqlc.arg('organization_id') AND url_hash = sqlc.arg('url_hash');

-- name: UpsertChatLinkPreview :one
-- A first fetch inserts; a retry overwrites only a failed row, so a card that
-- a concurrent delivery already stored is never replaced (no row comes back).
INSERT INTO chat_link_previews (
  id, organization_id, url_hash, url, status, title, description, site_name, image_file_id, fetched_at
) VALUES (
  sqlc.arg('id'), sqlc.arg('organization_id'), sqlc.arg('url_hash'), sqlc.arg('url'), sqlc.arg('status'),
  sqlc.arg('title'), sqlc.arg('description'), sqlc.arg('site_name'), sqlc.narg('image_file_id'), now()
)
ON CONFLICT (organization_id, url_hash) DO UPDATE SET
  status = EXCLUDED.status,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  site_name = EXCLUDED.site_name,
  image_file_id = EXCLUDED.image_file_id,
  fetched_at = EXCLUDED.fetched_at
WHERE chat_link_previews.status = 'failed'
RETURNING *;

-- name: InsertChatMessageLinkPreview :execrows
-- A redelivered request finds the row already there and writes nothing.
INSERT INTO chat_message_link_previews (message_id, organization_id, room_id, preview_id)
VALUES (sqlc.arg('message_id'), sqlc.arg('organization_id'), sqlc.arg('room_id'), sqlc.arg('preview_id'))
ON CONFLICT (message_id) DO NOTHING;

-- name: GetChatMessageLinkPreviewID :one
-- The card a message shows, so a forwarded copy can show the same one.
SELECT preview_id FROM chat_message_link_previews
WHERE organization_id = sqlc.arg('organization_id') AND message_id = sqlc.arg('message_id');

-- name: ListChatRoomLinkPreviews :many
-- The cards of the messages a timeline shows, in one read. Only cards to
-- show: a failed or blocked fetch has nothing for a viewer.
SELECT m.message_id, p.url, p.title, p.description, p.site_name, p.image_file_id
FROM chat_message_link_previews m
JOIN chat_link_previews p ON p.id = m.preview_id AND p.organization_id = m.organization_id
WHERE m.organization_id = sqlc.arg('organization_id')
  AND m.room_id = sqlc.arg('room_id')
  AND m.message_id = ANY(sqlc.arg('message_ids')::text[])
  AND p.status = 'ok';

-- name: ListChatLinkPreviewImageFileIDs :many
-- tenant: system
-- The collector's question: which of these files a cached card still shows.
SELECT image_file_id FROM chat_link_previews
WHERE image_file_id = ANY(sqlc.arg('file_ids')::text[]);
