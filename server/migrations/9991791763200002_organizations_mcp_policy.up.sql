-- An owner or admin turns the MCP connector on for the organization
-- (spec §8). NULL means off, the default.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS mcp_enabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mcp_enabled_by TEXT;
