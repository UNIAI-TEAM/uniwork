-- Document shares (C-01 §3.4; UNI-675). Basic CRUD for the share panel;
-- level evaluation and the "shared with me" listing land with G1-02. Revoke
-- stamps revoked_at/revoked_by - the row is also the history of the grant.

-- name: InsertDocumentShare :one
INSERT INTO document_shares (
  id, organization_id, workspace_id, document_id, principal_type,
  principal_id, level, granted_by, granted_by_kind,
  source_kind, source_room_id, source_message_id, prior_manual_level
) VALUES (
  sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(workspace_id),
  sqlc.arg(document_id), sqlc.arg(principal_type),
  sqlc.arg(principal_id), sqlc.arg(level), sqlc.arg(granted_by),
  sqlc.arg(granted_by_kind),
  sqlc.narg(source_kind), sqlc.narg(source_room_id),
  sqlc.narg(source_message_id), sqlc.narg(prior_manual_level)
)
RETURNING *;

-- name: ListDocumentShares :many
SELECT *
FROM document_shares
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND revoked_at IS NULL
ORDER BY created_at, id;

-- The live grants on a page of documents of one workspace, read once so a list
-- can resolve every row's level without a query per row. Only the columns
-- the level rule needs.
-- name: ListLiveSharesForDocuments :many
SELECT document_id, principal_type, principal_id, level
FROM document_shares
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = ANY(sqlc.arg(document_ids)::text[])
  AND revoked_at IS NULL;

-- The live grant for a principal on a document, used when re-granting.
-- name: GetDocumentShare :one
SELECT *
FROM document_shares
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND principal_type = sqlc.arg(principal_type)
  AND principal_id = sqlc.arg(principal_id)
  AND revoked_at IS NULL;

-- name: RevokeDocumentShare :exec
UPDATE document_shares
SET revoked_at = now(), revoked_by = sqlc.arg(revoked_by)
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND revoked_at IS NULL;

-- The multi-row form of InsertDocumentShare for a command that grants one
-- level to many users of one document at once (UNI-2012 S1c: a chat send to a
-- large room, a Documents batch share). The service writes it in chunks inside
-- its one transaction, so a 1,000-person grant is a handful of statements
-- instead of a round trip per grantee. The tenant pair, document, level,
-- grantor and chat source are one per call; ids, principals and the
-- remembered manual level (empty = NULL) arrive as parallel arrays.
-- name: InsertUserDocumentSharesBatch :many
-- tenant: parent document_id
-- The organization/workspace pair written is the authorized document's own.
INSERT INTO document_shares (
  id, organization_id, workspace_id, document_id, principal_type,
  principal_id, level, granted_by, granted_by_kind,
  source_kind, source_room_id, source_message_id, prior_manual_level
)
SELECT r.id, sqlc.arg(organization_id)::text, sqlc.arg(workspace_id)::text,
  sqlc.arg(document_id)::text, 'user',
  r.principal_id, sqlc.arg(level)::text, sqlc.arg(granted_by)::text,
  sqlc.arg(granted_by_kind)::text,
  sqlc.narg(source_kind)::text, sqlc.narg(source_room_id)::text,
  sqlc.narg(source_message_id)::text, NULLIF(r.prior_manual_level, '')
FROM (
  SELECT unnest(sqlc.arg(ids)::text[]) AS id,
    unnest(sqlc.arg(principal_ids)::text[]) AS principal_id,
    unnest(sqlc.arg(prior_manual_levels)::text[]) AS prior_manual_level
) AS r
RETURNING *;

-- The multi-row form of RevokeDocumentShare: the live rows a batch grant
-- replaces at another level, ended in one statement per chunk.
-- name: RevokeDocumentSharesByIDs :exec
UPDATE document_shares
SET revoked_at = now(), revoked_by = sqlc.arg(revoked_by)
WHERE id = ANY(sqlc.arg(ids)::text[])
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND revoked_at IS NULL;

-- The caller's live emergency view grant on a document (DOC-05; UNI-1628).
-- name: GetLiveDocumentBreakGlassGrantForActor :one
SELECT *
FROM document_break_glass_grants
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND actor_id = sqlc.arg(actor_id)
  AND actor_kind = sqlc.arg(actor_kind)
  AND revoked_at IS NULL
  AND expires_at > now()
ORDER BY granted_at DESC, id DESC
LIMIT 1;

-- The caller's live emergency view grants on a page of documents of one
-- workspace, read once so a list can resolve every restricted row's level
-- without a query per row (DOC-05; UNI-1628).
-- name: ListLiveBreakGlassGrantsForDocuments :many
SELECT document_id, level
FROM document_break_glass_grants
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = ANY(sqlc.arg(document_ids)::text[])
  AND actor_id = sqlc.arg(actor_id)
  AND actor_kind = sqlc.arg(actor_kind)
  AND revoked_at IS NULL
  AND expires_at > now();

-- Group preview counts for PUT /documents/{documentID}/access (SH-S2, UNI-1781,
-- D5): member_count and losing_count of one workspace or organization group
-- item in one SQL query without loading member names.
--
-- The group's membership is the EFFECTIVE membership the resolver decides
-- (WorkspaceService.RequireMember -> GetWorkspaceAccess): a workspace_members
-- row, or an organization owner/admin, who is an implicit admin of every
-- workspace of the organization (R1-03, R1-04). A person who is not an
-- effective member of the document's own workspace holds no role-based level
-- (R1-07): the ACL-owner path is evaluated only inside that membership.
--
-- The home workspace role is the EFFECTIVE role GetWorkspaceAccess returns
-- (workspaces.sql:78): COALESCE(explicit workspace role, implicit org
-- admin) - an explicit workspace_members row WINS over the organization
-- role (R2-01). An organization admin who also holds an explicit home
-- `member` row is a plain member there, so they hold no role manage and no
-- AdminScope, exactly as the resolver decides. Everywhere the home role is
-- read below, this expression is the one used; it is repeated because the
-- join is a LEFT JOIN and no alias can be referenced in the same SELECT.
--
-- losing_count counts the effective members whose post-batch level falls below
-- the rank the group grants today. The post-batch level is the greatest of the
-- paths the resolver walks (document_permissions.go), each expressed here:
--   * role manage - an effective admin of the document's workspace (effective
--     home role, R2-01), only while the document stays workspace-visible: a
--     restricted document hands admins AdminScope, never a level, so their
--     level comes from the shares and the break-glass grant below (R1-05).
--   * ACL owner manage - only while the home-membership prerequisite holds.
--   * the home row's level merged with a legacy home-workspace share
--     (home_after_rank): the member level while workspace-visible, and on a
--     restricted document exactly the legacy share's level, which is what a
--     member keeps.
--   * a surviving organization grant (org_preserves).
--   * a surviving direct user grant (preserved_user_ids).
--   * a surviving workspace grant whose workspace the person effectively
--     belongs to - a workspace_members row, or an implicit organization
--     owner/admin (R1-04).
--   * a live break-glass grant, view only, and only while the holder still
--     holds AdminScope - which is the effective home role, never the raw
--     organization role (R1-06, R2-01).
-- name: CountDocumentAccessPreviewGroup :one
SELECT
  count(*)::bigint AS member_count,
  count(*) FILTER (
    WHERE sqlc.arg(prev_group_rank)::int > 0
      AND sqlc.arg(after_group_rank)::int < sqlc.arg(prev_group_rank)::int
      AND GREATEST(
        CASE
          WHEN COALESCE(hwm.role, CASE WHEN om.role IN ('owner', 'admin') THEN 'admin' END, '') IN ('owner', 'admin')
            AND sqlc.arg(home_visible)::boolean
          THEN 4 ELSE 0
        END,
        CASE
          WHEN COALESCE(hwm.role, CASE WHEN om.role IN ('owner', 'admin') THEN 'admin' END, '') <> ''
            AND om.user_id = sqlc.narg(acl_owner_id)::text
          THEN 4 ELSE 0
        END,
        CASE
          WHEN COALESCE(hwm.role, CASE WHEN om.role IN ('owner', 'admin') THEN 'admin' END, '') <> ''
          THEN sqlc.arg(home_after_rank)::int ELSE 0
        END,
        CASE WHEN sqlc.arg(org_preserves)::boolean THEN sqlc.arg(prev_group_rank)::int ELSE 0 END,
        CASE WHEN om.user_id = ANY(sqlc.arg(preserved_user_ids)::text[]) THEN sqlc.arg(prev_group_rank)::int ELSE 0 END,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM workspace_members swm
            WHERE swm.organization_id = om.organization_id
              AND swm.user_id = om.user_id
              AND swm.workspace_id = ANY(sqlc.arg(preserved_ws_ids)::text[])
          ) OR (om.role IN ('owner', 'admin') AND cardinality(sqlc.arg(preserved_ws_ids)::text[]) > 0)
          THEN sqlc.arg(prev_group_rank)::int ELSE 0
        END,
        CASE
          WHEN COALESCE(hwm.role, CASE WHEN om.role IN ('owner', 'admin') THEN 'admin' END, '') IN ('owner', 'admin')
            AND NOT sqlc.arg(home_visible)::boolean
            AND sqlc.narg(acl_owner_id)::text IS DISTINCT FROM om.user_id
            AND EXISTS (
              SELECT 1 FROM document_break_glass_grants bg
              WHERE bg.organization_id = om.organization_id
                AND bg.workspace_id = sqlc.arg(home_workspace_id)::text
                AND bg.document_id = sqlc.arg(document_id)::text
                AND bg.actor_id = om.user_id
                AND bg.actor_kind = 'human'
                AND bg.revoked_at IS NULL
                AND bg.expires_at > now()
            )
          THEN 1 ELSE 0
        END
      ) < sqlc.arg(prev_group_rank)::int
  )::bigint AS losing_count
FROM organization_members om
LEFT JOIN workspace_members hwm
  ON hwm.organization_id = om.organization_id
 AND hwm.workspace_id = sqlc.arg(home_workspace_id)::text
 AND hwm.user_id = om.user_id
LEFT JOIN workspace_members wm
  ON wm.organization_id = om.organization_id
 AND wm.workspace_id = sqlc.arg(principal_id)::text
 AND wm.user_id = om.user_id
WHERE om.organization_id = sqlc.arg(organization_id)::text
  AND om.deactivated_at IS NULL
  AND (
    sqlc.arg(principal_type)::text = 'organization'
    OR wm.user_id IS NOT NULL
    OR om.role IN ('owner', 'admin')
  );


-- The live grant count of one document: the §5 "Đã chia sẻ với N người"
-- aggregate on a chat document message, read only for the sender. Shares are
-- keyed by document, never by version, so a version message counts the same
-- audience as the document it names.
-- name: CountLiveDocumentShares :one
SELECT count(*)::bigint
FROM document_shares
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND revoked_at IS NULL;

-- Live chat-origin shares granted to one user from one chat room in the
-- organization (UNI-2012 D2a). Manual shares and pre-existing chat shares have
-- source_kind IS NULL and are never returned here.
-- name: ListLiveChatDocumentSharesForUserInRoom :many
SELECT *
FROM document_shares
WHERE organization_id = sqlc.arg(organization_id)
  AND principal_type = 'user'
  AND principal_id = sqlc.arg(user_id)
  AND source_kind = 'chat'
  AND source_room_id = sqlc.arg(room_id)
  AND revoked_at IS NULL
ORDER BY created_at, id;

-- Live chat-origin shares granted to one user in the organization whose source
-- room no longer holds the user as an invited or active member (UNI-2012 D2a).
-- name: ListLiveChatDocumentSharesForUserLeftRooms :many
SELECT s.*
FROM document_shares s
WHERE s.organization_id = sqlc.arg(organization_id)
  AND s.principal_type = 'user'
  AND s.principal_id = sqlc.arg(user_id)
  AND s.source_kind = 'chat'
  AND s.revoked_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM chat_room_members m
    JOIN chat_rooms r ON r.id = m.room_id
    WHERE m.organization_id = s.organization_id
      AND m.room_id = s.source_room_id
      AND m.user_id = s.principal_id
      AND m.status IN ('invited', 'active')
      AND r.archived_at IS NULL
  )
ORDER BY s.created_at, s.id;

-- Another non-archived chat room in the organization where the user is still
-- an invited or active member and a live document message names the document
-- (UNI-2012 D2a).
-- name: FindActiveChatRoomDocumentMessageForUser :one
SELECT m.room_id, msg.id AS message_id
FROM chat_room_members m
JOIN chat_rooms r
  ON r.id = m.room_id
 AND r.organization_id = m.organization_id
JOIN chat_messages msg
  ON msg.room_id = m.room_id
 AND msg.organization_id = m.organization_id
WHERE m.organization_id = sqlc.arg(organization_id)
  AND m.user_id = sqlc.arg(user_id)
  AND m.status IN ('invited', 'active')
  AND r.archived_at IS NULL
  AND msg.deleted_at IS NULL
  AND msg.kind = 'document'
  AND msg.metadata->>'document_id' = sqlc.arg(document_id)::text
  AND (sqlc.arg(exclude_room_id)::text = '' OR m.room_id <> sqlc.arg(exclude_room_id)::text)
ORDER BY msg.created_at ASC, msg.id ASC
LIMIT 1;

-- Re-points a live chat-origin share to a surviving room and message when the
-- recipient leaves one room while remaining active in another room that holds
-- a live card for the same document (UNI-2012 D2a).
-- name: RepointDocumentShareChatSource :one
UPDATE document_shares
SET source_room_id = sqlc.arg(source_room_id),
    source_message_id = sqlc.narg(source_message_id)
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id)
  AND source_kind = 'chat'
  AND revoked_at IS NULL
RETURNING *;
