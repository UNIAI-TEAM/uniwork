-- An owner or admin lets connected AI apps create and edit, on top of the
-- read access mcp_enabled_at opens (ADR 0033). NULL means off, the default.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS mcp_write_enabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mcp_write_enabled_by TEXT;
