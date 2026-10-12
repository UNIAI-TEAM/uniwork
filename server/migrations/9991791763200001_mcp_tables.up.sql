-- MCP connector (UNI-1308, spec 2026-10-12-mcp-connector, ADR 0031).
-- mcp_clients and mcp_auth_attempts are identity tables (no tenant yet);
-- grants and tokens belong to the organization the user chose on consent.
CREATE TABLE mcp_clients (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cimd', 'dcr')),
  client_name TEXT NOT NULL,
  logo_uri TEXT NOT NULL DEFAULT '',
  redirect_uris TEXT NOT NULL DEFAULT '[]',
  token_endpoint_auth_method TEXT NOT NULL
    CHECK (token_endpoint_auth_method IN ('none', 'client_secret_post', 'client_secret_basic')),
  secret_digest TEXT,
  metadata_fetched_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mcp_auth_attempts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT '',
  user_id TEXT,
  csrf_digest TEXT,
  grant_id TEXT,
  code_digest TEXT,
  code_expires_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mcp_grants (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_kind TEXT NOT NULL DEFAULT 'human' CHECK (created_by_kind IN ('human', 'agent', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  revoked_by_kind TEXT CHECK (revoked_by_kind IN ('human', 'agent', 'system'))
);

CREATE TABLE mcp_tokens (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  digest TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
