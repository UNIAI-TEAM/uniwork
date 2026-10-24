-- name: AiLockMemoryOwner :exec
-- Serialises every command that adds an entry, so the 50-entry cap holds when
-- two tabs add at once. Released at commit.
SELECT pg_advisory_xact_lock(hashtextextended('ai_memory:' || sqlc.arg(organization_id)::text || ':' || sqlc.arg(user_id)::text, 0));

-- name: AiCountMemories :one
SELECT count(*) FROM ai_memories WHERE organization_id = $1 AND user_id = $2;

-- name: AiListMemories :many
SELECT * FROM ai_memories
WHERE organization_id = $1 AND user_id = $2
ORDER BY (kind = 'preference') DESC, created_at, id;

-- name: AiGetMemory :one
SELECT * FROM ai_memories WHERE id = $1 AND organization_id = $2 AND user_id = $3;

-- name: AiInsertMemory :one
INSERT INTO ai_memories (
  id, organization_id, user_id, kind, body, source, proposal_id, created_by, created_by_kind
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: AiUpdateMemory :one
UPDATE ai_memories SET kind = $4, body = $5, updated_at = now()
WHERE id = $1 AND organization_id = $2 AND user_id = $3
RETURNING *;

-- name: AiDeleteMemory :execrows
DELETE FROM ai_memories WHERE id = $1 AND organization_id = $2 AND user_id = $3;

-- name: AiClearMemories :execrows
DELETE FROM ai_memories WHERE organization_id = $1 AND user_id = $2;

-- name: AiDeleteMemoriesForUserInOrg :execrows
DELETE FROM ai_memories WHERE organization_id = $1 AND user_id = $2;

-- name: AiDeleteMemoriesForUser :execrows
-- tenant: self
-- Account deletion: the person's memory in every organization goes with them.
DELETE FROM ai_memories WHERE user_id = $1;

-- name: AiInsertMemoryProposal :one
INSERT INTO ai_memory_proposals (
  id, organization_id, workspace_id, conversation_id, message_id, position, action,
  memory_id, kind, body, before_kind, before_body, status, expires_at, created_by,
  created_by_kind
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', $13, $14, $15
)
RETURNING *;

-- name: AiGetMemoryProposal :one
-- tenant: by-id
-- The service compares created_by and re-runs RequireMember before using it.
SELECT * FROM ai_memory_proposals WHERE id = $1;

-- name: AiLockMemoryProposal :one
SELECT * FROM ai_memory_proposals WHERE id = $1 AND organization_id = $2 FOR UPDATE;

-- name: AiSetMemoryProposalStatus :one
-- decided_at is the database clock, the one the undo guard compares with the
-- entry's updated_at.
UPDATE ai_memory_proposals SET
  status = sqlc.arg(status),
  memory_id = COALESCE(sqlc.narg(memory_id)::text, memory_id),
  decided_at = now(),
  updated_at = now()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
RETURNING *;

-- name: AiEditMemoryProposal :one
UPDATE ai_memory_proposals SET kind = sqlc.narg(kind), body = sqlc.narg(body), updated_at = now()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id) AND status = 'pending'
RETURNING *;

-- name: AiListMemoryProposalsForMessages :many
SELECT * FROM ai_memory_proposals
WHERE organization_id = sqlc.arg(organization_id)
  AND message_id = ANY(sqlc.arg(message_ids)::text[])
ORDER BY message_id, position;

-- name: AiCountMessageMemoryProposals :one
SELECT count(*) FROM ai_memory_proposals WHERE organization_id = $1 AND message_id = $2;

-- name: AiDeleteConversationMemoryProposals :exec
DELETE FROM ai_memory_proposals WHERE organization_id = $1 AND conversation_id = $2;
