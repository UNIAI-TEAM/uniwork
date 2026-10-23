ALTER TABLE organizations
  DROP COLUMN IF EXISTS mcp_write_enabled_by,
  DROP COLUMN IF EXISTS mcp_write_enabled_at;
