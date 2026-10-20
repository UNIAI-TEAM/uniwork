-- name: ListLiveChatDocumentCardMessages :many
-- The live chat cards of one document in an organization, newest first (UNI-2012
-- S1b). Served by idx_chat_messages_org_document_card. A card of another
-- organization never matches: the organization is the first predicate.
SELECT id, room_id
FROM chat_messages
WHERE organization_id = sqlc.arg(organization_id)
  AND kind = 'document'
  AND deleted_at IS NULL
  AND metadata->>'document_id' = sqlc.arg(document_id)::text
ORDER BY created_at DESC, id DESC
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
