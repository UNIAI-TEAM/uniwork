CREATE TABLE desktop_auth_attempts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
  redirect_uri TEXT NOT NULL,
  state TEXT NOT NULL,
  state_digest TEXT NOT NULL,
  csrf_digest TEXT,
  code_digest TEXT,
  code_expires_at TIMESTAMPTZ,
  user_id TEXT,
  device_label TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  build TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE device_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_family_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  device_label TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  build TEXT NOT NULL DEFAULT '',
  refresh_token_digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by_kind TEXT NOT NULL DEFAULT 'human' CHECK (created_by_kind IN ('human', 'agent', 'system'))
);
