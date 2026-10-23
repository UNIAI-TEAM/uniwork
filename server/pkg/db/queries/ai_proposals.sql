-- name: AiInsertProposal :one
INSERT INTO agent_action_proposals (
  id, organization_id, workspace_id, source, run_id, agent_id, conversation_id,
  message_id, position, action_type, target_kind, target_id, payload, preview,
  risk_level, mode, tainted, target_revision, status, expires_at, created_by,
  created_by_kind
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
  $18, $19, $20, $21, $22
)
RETURNING *;

-- name: AiListProposalsForMessages :many
SELECT * FROM agent_action_proposals
WHERE organization_id = sqlc.arg(organization_id)
  AND message_id = ANY(sqlc.arg(message_ids)::text[])
ORDER BY message_id, position;

-- name: AiGetProposal :one
-- tenant: by-id
-- The service compares created_by and re-runs RequireMember before using it.
SELECT * FROM agent_action_proposals WHERE id = $1;

-- name: AiClaimProposal :one
UPDATE agent_action_proposals SET status = sqlc.arg(to_status), updated_at = now()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
  AND status = sqlc.arg(from_status)
RETURNING *;

-- name: AiSettleProposal :one
UPDATE agent_action_proposals SET
  status = sqlc.arg(status),
  result = sqlc.arg(result),
  undo = sqlc.narg(undo),
  error = sqlc.narg(error),
  decision = COALESCE(sqlc.narg(decision), decision),
  decided_by = COALESCE(sqlc.narg(decided_by), decided_by),
  decided_at = CASE WHEN sqlc.narg(decided_by)::text IS NULL THEN decided_at ELSE COALESCE(decided_at, now()) END,
  applied_at = CASE WHEN sqlc.arg(status) = 'applied' THEN now() ELSE applied_at END,
  undone_by = CASE WHEN sqlc.arg(status) = 'undone' THEN sqlc.narg(decided_by) ELSE undone_by END,
  undone_at = CASE WHEN sqlc.arg(status) = 'undone' THEN now() ELSE undone_at END,
  updated_at = now()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
RETURNING *;

-- name: AiUpdateProposalDraft :one
UPDATE agent_action_proposals SET
  payload = sqlc.arg(payload), preview = sqlc.arg(preview),
  risk_level = sqlc.arg(risk_level), updated_at = now()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
  AND status = 'pending'
RETURNING *;

-- name: AiCountMessageProposals :one
SELECT count(*) FROM agent_action_proposals
WHERE organization_id = $1 AND message_id = $2;

-- name: AiDeleteConversationProposals :exec
DELETE FROM agent_action_proposals
WHERE organization_id = $1 AND conversation_id = $2;
