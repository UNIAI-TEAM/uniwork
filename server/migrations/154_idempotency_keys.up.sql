-- Idempotency ledger for create/comment (and later mutations) keyed per
-- organization + workspace + scope + client key. Response columns stay NULL
-- until the command commits so a retry can distinguish in-flight from done.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  response_status INTEGER,
  response_body BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
