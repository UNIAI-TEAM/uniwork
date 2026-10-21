-- The documents of a document_changed notification (UNI-2056). Written by
-- the notification consumer; read by the recipient through the notification
-- they own.

-- name: InsertNotificationDocument :execrows
-- tenant: system
-- Insert-ignore: a document already listed (renamed twice inside the fold
-- window, or a redelivered event) keeps its first row and is not counted
-- again. 0 rows means it was already there.
INSERT INTO notification_documents (organization_id, notification_id, document_id, title_snapshot)
VALUES (sqlc.arg('organization_id'), sqlc.arg('notification_id'), sqlc.arg('document_id'), sqlc.narg('title_snapshot'))
ON CONFLICT (notification_id, document_id) DO NOTHING;

-- name: CountNotificationDocuments :one
-- tenant: parent notification_id
-- The distinct documents of one notification: its document_count.
SELECT count(*)::bigint FROM notification_documents
WHERE notification_id = sqlc.arg('notification_id');

-- name: ListNotificationDocumentSamples :many
-- tenant: parent notification_id
-- The first documents a notification gathered, in the order they arrived:
-- the sample the inbox names ("A, B, C and 47 more").
SELECT document_id FROM notification_documents
WHERE notification_id = sqlc.arg('notification_id')
ORDER BY created_at, document_id
LIMIT sqlc.arg('limit_n');

-- name: ListNotificationDocumentsForReader :many
-- tenant: self
-- One page of a notification's documents for its recipient: the join on
-- notifications.user_id makes another person's notification read as empty.
-- Keyset on document_id (the primary key's second column); the caller
-- filters each row through the document read gate before showing it.
SELECT nd.notification_id, nd.document_id, nd.title_snapshot, nd.created_at
FROM notification_documents nd
JOIN notifications n ON n.id = nd.notification_id
WHERE n.user_id = sqlc.arg('user_id')
  AND nd.notification_id = sqlc.arg('notification_id')
  AND (sqlc.narg('after')::text IS NULL OR nd.document_id > sqlc.narg('after')::text)
ORDER BY nd.document_id
LIMIT sqlc.arg('limit_n');
