-- Per-user AI provider credentials for the Office web host (UNI-1008 GO-A7,
-- ADR 0029): a person's own vendor API key, stored so a web call can go
-- through ai.Gateway without the key ever reaching the browser. One row per
-- (organization, user, provider); every statement filters by
-- (organization_id, user_id). secret_ciphertext is the key sealed with
-- AI_CREDENTIAL_KEY (secretbox, AES-256-GCM); key_hint is the only part of it
-- a response carries. No foreign keys: the owner relationship and cleanup
-- live in service code (ADR 0008, migration rules).
CREATE TABLE IF NOT EXISTS ai_provider_credentials (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  provider          TEXT NOT NULL,
  label             TEXT NOT NULL DEFAULT '',
  base_url          TEXT NOT NULL DEFAULT '',
  secret_ciphertext BYTEA NOT NULL,
  key_hint          TEXT NOT NULL,
  created_by        TEXT NOT NULL,
  created_by_kind   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ai_provider_credentials_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system'))
);
