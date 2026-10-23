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

-- name: AiSettleProposalApply :one
-- Apply path: applying -> applied | failed, and pending -> rejected. Guarded by
-- from_status so a settle never clobbers a row in another state.
UPDATE agent_action_proposals SET
  status = sqlc.arg(status),
  result = sqlc.arg(result),
  undo = sqlc.narg(undo),
  error = sqlc.narg(error),
  decision = sqlc.narg(decision),
  decided_by = sqlc.arg(decided_by),
  decided_at = now(),
  applied_at = CASE WHEN sqlc.arg(status) = 'applied' THEN now() ELSE applied_at END,
  updated_at = now()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
  AND status = sqlc.arg(from_status)
RETURNING *;

-- name: AiSettleProposalUndo :one
-- Undo path: undoing -> undone | applied. Never touches result, undo, decided_*
-- or applied_at, so a rollback keeps the undo command and the original apply.
UPDATE agent_action_proposals SET
  status = sqlc.arg(status),
  error = sqlc.narg(error),
  undone_by = CASE WHEN sqlc.arg(status) = 'undone' THEN sqlc.narg(undone_by)::text ELSE undone_by END,
  undone_at = CASE WHEN sqlc.arg(status) = 'undone' THEN now() ELSE undone_at END,
  updated_at = now()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
  AND status = sqlc.arg(from_status)
RETURNING *;

-- name: AiUpdateProposalDraft :one
-- An edit runs prepare again, so the target and the revision it read change
-- with the payload and the preview.
UPDATE agent_action_proposals SET
  payload = sqlc.arg(payload), preview = sqlc.arg(preview),
  risk_level = sqlc.arg(risk_level), target_id = sqlc.narg(target_id),
  target_revision = sqlc.narg(target_revision), updated_at = now()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
  AND status = 'pending'
RETURNING *;

-- name: AiCountMessageProposals :one
SELECT count(*) FROM agent_action_proposals
WHERE organization_id = $1 AND message_id = $2;

-- name: AiDeleteConversationProposals :exec
DELETE FROM agent_action_proposals
WHERE organization_id = $1 AND conversation_id = $2;
