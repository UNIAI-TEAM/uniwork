-- Office launch capabilities (G4-05b). The row is document-scoped and is
-- intentionally not linked with a foreign key; service code owns lifecycle
-- cleanup and every query carries the tenant pair.
CREATE TABLE office_launch_sessions (
  id TEXT PRIMARY KEY,
  ticket_hash TEXT NOT NULL,
  account_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('view', 'edit')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  client_id TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  device_session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('human', 'agent', 'system'))
);
