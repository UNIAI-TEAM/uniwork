-- name: CreateAgent :one
INSERT INTO agents (id, organization_id, name, handle, description, avatar_url, owner_user_id, autonomy_policy, created_by, created_by_kind)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: GetAgent :one
SELECT * FROM agents WHERE id = $1;

-- name: GetAgentsByIDs :many
SELECT id, name, avatar_url, status FROM agents WHERE id = ANY(sqlc.arg('ids')::text[]);

-- name: ListAgentsInOrg :many
SELECT * FROM agents WHERE organization_id = $1 AND archived_at IS NULL ORDER BY created_at;

-- name: ListActiveAgentsInOrg :many
SELECT * FROM agents WHERE organization_id = $1 AND status = 'active' AND archived_at IS NULL ORDER BY created_at;

-- name: UpdateAgent :one
UPDATE agents SET
  name        = COALESCE(sqlc.narg('name'), name),
  description = COALESCE(sqlc.narg('description'), description),
  avatar_url  = COALESCE(sqlc.narg('avatar_url'), avatar_url),
  status      = COALESCE(sqlc.narg('status'), status),
  updated_at  = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: AddWorkspaceAgentMember :exec
INSERT INTO workspace_agent_members (workspace_id, agent_id, organization_id, created_by, created_by_kind)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT DO NOTHING;

-- name: GetWorkspaceAgentMember :one
SELECT * FROM workspace_agent_members WHERE workspace_id = $1 AND agent_id = $2;

-- name: ListWorkspaceAgents :many
SELECT a.id, a.organization_id, a.name, a.handle, a.description, a.avatar_url, a.status, a.owner_user_id, m.created_at AS joined_at
FROM workspace_agent_members m JOIN agents a ON a.id = m.agent_id
WHERE m.workspace_id = $1 AND a.archived_at IS NULL
ORDER BY m.created_at;
