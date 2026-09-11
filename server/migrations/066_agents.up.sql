-- ADR 0007: an agent is an actor in its own right. It belongs to an
-- organization, never logs in, and joins a workspace through its own
-- membership table (OPEN_QUESTIONS AG1) so workspace_members stays "people".
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  handle TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  owner_user_id TEXT NOT NULL,
  autonomy_policy TEXT NOT NULL DEFAULT '{}',
  allowed_tools TEXT NOT NULL DEFAULT '[]',
  skills TEXT NOT NULL DEFAULT '[]',
  budget_tokens_per_run INTEGER NOT NULL DEFAULT 60000,
  created_by TEXT NOT NULL,
  created_by_kind TEXT NOT NULL DEFAULT 'human' CHECK (created_by_kind IN ('human', 'agent', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS workspace_agent_members (
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role = 'agent'),
  created_by TEXT NOT NULL,
  created_by_kind TEXT NOT NULL DEFAULT 'human' CHECK (created_by_kind IN ('human', 'agent', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, agent_id)
);
