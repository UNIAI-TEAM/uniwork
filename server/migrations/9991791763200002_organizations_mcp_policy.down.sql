ALTER TABLE organizations
  DROP COLUMN IF EXISTS mcp_enabled_by,
  DROP COLUMN IF EXISTS mcp_enabled_at;
