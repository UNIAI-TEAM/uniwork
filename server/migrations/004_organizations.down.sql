-- Chỉ an toàn khi không còn 2 workspace trùng slug ở 2 org khác nhau.
DROP INDEX IF EXISTS idx_tasks_welcome_once;
ALTER TABLE tasks DROP COLUMN IF EXISTS kind;
ALTER TABLE users DROP COLUMN IF EXISTS onboarding_questionnaire;
ALTER TABLE users DROP COLUMN IF EXISTS onboarded_at;
DROP INDEX IF EXISTS idx_workspaces_org;
DROP INDEX IF EXISTS idx_workspaces_org_slug;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_slug_key UNIQUE (slug);
ALTER TABLE workspaces DROP COLUMN organization_id;
DROP TABLE organization_members;
DROP TABLE organizations;
