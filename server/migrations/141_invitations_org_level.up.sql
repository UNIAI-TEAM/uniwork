-- F-03: an invitation can now be to the organization itself, not only to one
-- workspace inside it. The same table serves both — an org-level invite simply
-- has no workspace — so a person accepting either one travels the same code
-- path and there is no second token to keep in step (spec §2 decision 5).
ALTER TABLE invitations ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS org_role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS invited_by TEXT;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- Every existing invitation belongs to the organization that owns its
-- workspace, so the column can be filled and then required.
UPDATE invitations i SET organization_id = w.organization_id
FROM workspaces w WHERE w.id = i.workspace_id AND i.organization_id IS NULL;
DELETE FROM invitations WHERE organization_id IS NULL;
ALTER TABLE invitations ALTER COLUMN organization_id SET NOT NULL;
