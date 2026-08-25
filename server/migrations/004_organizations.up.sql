CREATE TABLE organizations (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX idx_org_members_user ON organization_members(user_id);

ALTER TABLE workspaces ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE;

-- Grandfather: mỗi workspace cũ → 1 org cùng slug/name/created_by.
-- id org = 'ORG' + 23 ký tự cuối id workspace (vẫn 26 ký tự, không đụng ULID mới).
INSERT INTO organizations (id, slug, name, created_by, created_at)
  SELECT 'ORG' || substr(id, 4), slug, name, created_by, created_at FROM workspaces;
INSERT INTO organization_members (organization_id, user_id, role, created_at)
  SELECT 'ORG' || substr(workspace_id, 4), user_id, role, created_at FROM workspace_members;
UPDATE workspaces SET organization_id = 'ORG' || substr(id, 4);
ALTER TABLE workspaces ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE workspaces DROP CONSTRAINT workspaces_slug_key;
CREATE UNIQUE INDEX idx_workspaces_org_slug ON workspaces(organization_id, slug);
CREATE INDEX idx_workspaces_org ON workspaces(organization_id);

ALTER TABLE users ADD COLUMN onboarded_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN onboarding_questionnaire JSONB NOT NULL DEFAULT '{}'::jsonb;
UPDATE users SET onboarded_at = created_at
  WHERE id IN (SELECT user_id FROM workspace_members);

ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal','welcome'));
CREATE UNIQUE INDEX idx_tasks_welcome_once ON tasks(workspace_id, created_by) WHERE kind = 'welcome';
