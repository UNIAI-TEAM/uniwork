-- Document comment mentions (G8-03, UNI-1398): the durable mention rows G8-05
-- writes and maintains inside the create/edit transaction. This file holds the
-- queries G8-03 owns - the tombstone and delete cleanup - and is where G8-05
-- adds its read/claim queries (ClaimDocumentCommentMention).

-- name: MarkDocumentCommentMentionsRemoved :exec
-- A tombstoned comment keeps its mention rows but no longer notifies: every
-- live or no-access mention becomes removed (contract-collab section 2.4).
UPDATE document_comment_mentions
SET state = 'removed',
    updated_at = now()
WHERE comment_id = $1
  AND document_id = $2
  AND organization_id = $3
  AND workspace_id = $4;

-- name: DeleteDocumentCommentMentions :exec
-- A hard-deleted comment takes its mention rows with it (no FK: service
-- cleanup in the delete transaction).
DELETE FROM document_comment_mentions
WHERE comment_id = $1
  AND document_id = $2
  AND organization_id = $3
  AND workspace_id = $4;

-- name: ListDocumentCommentMentions :many
-- The comment's current rows, the "existing" side of the mention sync (G8-05,
-- contract-collab section 8.1); read inside the create/edit transaction.
SELECT * FROM document_comment_mentions
WHERE comment_id = $1
  AND document_id = $2
  AND organization_id = $3
  AND workspace_id = $4
ORDER BY user_id;

-- name: InsertDocumentCommentMention :exec
-- One new mention row: active for a person who may read the document now,
-- no_access for one who may not (G8-D3 provisional - no error, no delivery).
INSERT INTO document_comment_mentions (
  id, organization_id, workspace_id, document_id, comment_id, user_id,
  state, created_by, created_by_kind
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);

-- name: ReactivateDocumentCommentMention :exec
-- A dropped mention that returns in the body: active again, notified_at kept,
-- so the same row never notifies twice (contract-collab section 8.1).
UPDATE document_comment_mentions
SET state = 'active',
    updated_at = now()
WHERE comment_id = $1
  AND user_id = $2
  AND document_id = $3
  AND organization_id = $4
  AND workspace_id = $5
  AND state = 'removed';

-- name: RemoveDocumentCommentMentions :exec
-- Ids no longer in the body become removed; their old notifications stay.
UPDATE document_comment_mentions
SET state = 'removed',
    updated_at = now()
WHERE comment_id = $1
  AND document_id = $2
  AND organization_id = $3
  AND workspace_id = $4
  AND user_id = ANY(sqlc.arg('user_ids')::text[])
  AND state <> 'removed';

-- name: ListClaimableDocumentCommentMentions :many
-- What the notification rules may draft for: live rows nobody claimed yet
-- (contract-collab section 8.2). The claim itself runs in the consumer's
-- notification transaction, so the rules stay read-only.
SELECT * FROM document_comment_mentions
WHERE comment_id = $1
  AND document_id = $2
  AND organization_id = $3
  AND workspace_id = $4
  AND state = 'active'
  AND notified_at IS NULL
ORDER BY user_id;

-- name: ClaimDocumentCommentMention :execrows
-- The claim (contract-collab section 8.2): one notification per mention row,
-- because only the transaction that set notified_at writes the row.
UPDATE document_comment_mentions
SET notified_at = now(),
    updated_at = now()
WHERE id = $1
  AND organization_id = $2
  AND notified_at IS NULL;
