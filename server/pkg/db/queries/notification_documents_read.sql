-- The read side of document_changed notifications (UNI-2056 slice B): the
-- inbox row a person owns, the cards of the documents it names, and the
-- snapshots a deleted verb stored. notification_documents.sql is the write
-- side and the keyset page.

-- name: GetOwnNotificationForDocuments :one
-- tenant: self
-- The caller's own notification: another person's id reads as no row, so the
-- route answers the same 404 for a foreign id and an unknown one.
SELECT id, kind, params FROM notifications
WHERE id = sqlc.arg('id') AND user_id = sqlc.arg('user_id');

-- name: ListDocumentCardsByIDs :many
-- tenant: by-id
-- One page of document cards in one query: the ids come from the caller's own
-- notification rows, and the caller shows a card only after the document read
-- gate (FilterReadableDocuments) lets this person see it.
SELECT id, kind, title, archived_at, shelved_at
FROM documents
WHERE id = ANY(sqlc.arg('ids')::text[]);

-- name: ListNotificationDocumentSnapshots :many
-- tenant: parent notification_id
-- The title taken at a purge, for the documents an inbox page names as samples.
-- Only a deleted verb stores one, so the rows are few; the caller keeps the
-- (notification, document) pairs it asked for.
SELECT notification_id, document_id, title_snapshot
FROM notification_documents
WHERE notification_id = ANY(sqlc.arg('notification_ids')::text[])
  AND document_id = ANY(sqlc.arg('document_ids')::text[])
  AND title_snapshot IS NOT NULL;
