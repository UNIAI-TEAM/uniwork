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
