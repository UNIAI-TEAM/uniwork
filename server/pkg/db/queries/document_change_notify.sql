-- DOC-CHANGE-NOTIFY (UNI-2056): the reads the document_changed rule makes
-- and the fold write path of its notification. Every recipient still passes
-- the document read gate in Go; these only name the candidates.

-- name: GetDocumentChangeFacts :one
-- tenant: by-id
-- The narrow row the rule needs, never the content: tenant pair, owner and
-- whether anyone besides the owner may read it (workspace visibility, a live
-- share of any principal, a live link). The rule checks the tenant pair
-- against the event's own.
SELECT d.id, d.organization_id, d.workspace_id, d.visibility, d.acl_owner_id,
  EXISTS (
    SELECT 1 FROM document_shares s
    WHERE s.organization_id = d.organization_id AND s.workspace_id = d.workspace_id
      AND s.document_id = d.id AND s.revoked_at IS NULL
  ) AS has_live_share,
  EXISTS (
    SELECT 1 FROM document_share_links l
    WHERE l.organization_id = d.organization_id AND l.workspace_id = d.workspace_id
      AND l.document_id = d.id AND l.revoked_at IS NULL AND l.expires_at > now()
  ) AS has_live_link
FROM documents d
WHERE d.id = sqlc.arg('id');

-- name: ListDocumentChangeAudience :many
-- The people a document change may reach besides its owner: live user
-- shares and stars. A workspace or organization share is a grant, not an
-- audience, so it never expands to every member (contract Q2).
SELECT s.principal_id::text AS user_id FROM document_shares s
WHERE s.organization_id = sqlc.arg('organization_id') AND s.workspace_id = sqlc.arg('workspace_id')
  AND s.document_id = sqlc.arg('document_id') AND s.revoked_at IS NULL AND s.principal_type = 'user'
UNION
SELECT f.user_id::text FROM document_favorites f
WHERE f.organization_id = sqlc.arg('organization_id') AND f.workspace_id = sqlc.arg('workspace_id')
  AND f.document_id = sqlc.arg('document_id');

-- name: ListCommandUserShareGrantees :many
-- The users one command granted a share to: they hear document_shared for
-- it, so no document_changed of the same command reaches them (rule 6).
-- Read from the command's own audit rows, so the answer does not depend on
-- which consumer ran first.
SELECT DISTINCT (metadata::jsonb ->> 'principal_id')::text AS user_id
FROM audit_events
WHERE organization_id = sqlc.arg('organization_id')
  AND correlation_id = sqlc.arg('correlation_id')
  AND action = 'document.shared'
  AND metadata::jsonb ->> 'principal_type' = 'user';

-- name: ListArchiveBatchOwners :many
-- The ACL owners of an archive batch's trashed nodes: the people
-- document_trashed_by_other addresses for that command.
SELECT DISTINCT acl_owner_id::text AS user_id FROM documents
WHERE organization_id = sqlc.arg('organization_id') AND workspace_id = sqlc.arg('workspace_id')
  AND archive_batch_id = sqlc.arg('archive_batch_id') AND archived_at IS NOT NULL
  AND acl_owner_id IS NOT NULL;

-- name: FindFoldableDocumentChange :one
-- tenant: self
-- The open document_changed row a new event folds into, under the group
-- claim the consumer holds: the row of the same command whatever its age,
-- otherwise the same actor and verb touched inside the sliding two-minute
-- window and less than thirty minutes after the row opened. FOR UPDATE keeps
-- a read or archive from landing between this read and the fold.
SELECT * FROM notifications
WHERE user_id = sqlc.arg('user_id')
  AND kind = 'document_changed'
  AND starts_with(group_key, sqlc.arg('group_prefix')::text)
  AND read_at IS NULL AND archived_at IS NULL
  AND (group_key = sqlc.arg('group_key')::text
       OR (updated_at > now() - interval '2 minutes' AND created_at > now() - interval '30 minutes'))
ORDER BY (group_key = sqlc.arg('group_key')::text) DESC, updated_at DESC
LIMIT 1
FOR UPDATE;

-- name: InsertNotification :one
-- tenant: system
-- A plain insert for a kind that folds by its own rule: the caller found no
-- open row of the group under its claim, so the open-group index cannot
-- collide.
INSERT INTO notifications (
  id, user_id, organization_id, workspace_id, kind, group_key,
  resource_type, resource_id, actor_kind, actor_id, title_key, params, correlation_id
) VALUES (
  sqlc.arg('id'), sqlc.arg('user_id'), sqlc.arg('organization_id'), sqlc.narg('workspace_id'), sqlc.arg('kind'),
  sqlc.arg('group_key'), sqlc.arg('resource_type'), sqlc.arg('resource_id'), sqlc.arg('actor_kind'),
  sqlc.arg('actor_id'), sqlc.arg('title_key'), sqlc.arg('params'), sqlc.narg('correlation_id')
)
RETURNING *;

-- name: FoldDocumentChange :one
-- tenant: self
-- The fold: count is the distinct documents now listed, params carry the
-- refreshed count and sample, and updated_at slides the window.
UPDATE notifications SET
  count = sqlc.arg('count'),
  params = sqlc.arg('params'),
  correlation_id = sqlc.narg('correlation_id'),
  updated_at = now()
WHERE id = sqlc.arg('id') AND user_id = sqlc.arg('user_id')
RETURNING *;
