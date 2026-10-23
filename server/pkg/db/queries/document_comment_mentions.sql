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
-- A dropped mention that returns in the body: the service re-checks read
-- access like for a new mention, so the row comes back active for a reader and
-- no_access for a non-reader (G8-18). notified_at is kept either way, so the
-- same row never notifies twice (contract-collab section 8.1).
UPDATE document_comment_mentions
SET state = sqlc.arg(state)::text,
    updated_at = now()
WHERE comment_id = sqlc.arg(comment_id)
  AND user_id = sqlc.arg(user_id)
  AND document_id = sqlc.arg(document_id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
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

-- name: ListNoAccessDocumentCommentMentions :many
-- The people one comment named who could not read the document when it was
-- saved (G8-18, UNI-1413): the no_access rows the create/edit transaction
-- wrote, answered to the author as mentions_without_access. display_name is
-- read only for a person who belongs to the organization (a stray id outside
-- it carries no name), and active_member tells the service whether a share
-- could ever be offered (a deactivated member keeps their name but cannot be
-- shared with). The row itself never changes: a later grant does not turn it
-- active, so it never notifies retroactively.
SELECT
  m.user_id,
  COALESCE(u.display_name, '')::text AS display_name,
  (om.user_id IS NOT NULL AND om.deactivated_at IS NULL)::boolean AS active_member
FROM document_comment_mentions m
LEFT JOIN organization_members om
  ON om.user_id = m.user_id
 AND om.organization_id = m.organization_id
LEFT JOIN users u ON u.id = om.user_id
WHERE m.comment_id = $1
  AND m.document_id = $2
  AND m.organization_id = $3
  AND m.workspace_id = $4
  AND m.state = 'no_access'
ORDER BY m.user_id;
