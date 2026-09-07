-- F-11: who granted the platform role and when (spec §4). Grant/revoke is
-- CLI only (uniwork-admin); admin_actions and audit_events carry the reason.
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_role_granted_by TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_role_granted_at TIMESTAMPTZ;
