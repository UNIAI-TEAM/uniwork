-- The demotions in the up direction are not reversed: the earlier state had no
-- record of which admins used to be owners.
ALTER TABLE organization_members DROP COLUMN IF EXISTS updated_at;
ALTER TABLE organization_members DROP COLUMN IF EXISTS invited_by;
ALTER TABLE organization_members DROP COLUMN IF EXISTS deactivated_by;
ALTER TABLE organization_members DROP COLUMN IF EXISTS deactivated_at;
