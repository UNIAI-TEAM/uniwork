-- Org-level invitations have no workspace, so they cannot survive the column
-- becoming NOT NULL again.
DELETE FROM invitations WHERE workspace_id IS NULL;
ALTER TABLE invitations DROP COLUMN IF EXISTS revoked_at;
ALTER TABLE invitations DROP COLUMN IF EXISTS invited_by;
ALTER TABLE invitations DROP COLUMN IF EXISTS org_role;
ALTER TABLE invitations DROP COLUMN IF EXISTS organization_id;
ALTER TABLE invitations ALTER COLUMN workspace_id SET NOT NULL;
