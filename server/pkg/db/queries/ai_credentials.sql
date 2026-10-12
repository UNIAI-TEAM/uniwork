-- Per-user AI provider credentials (UNI-1008 GO-A7, ADR 0029). Rows are
-- personal, so every statement filters by organization_id and user_id
-- together; AICredentialService gates organization membership before it
-- calls any of these. The names carry no Ai prefix on purpose: internal/ai
-- may only call Ai* queries, and it must never read a stored key itself.

-- name: ListProviderCredentials :many
SELECT id, provider, label, base_url, key_hint, model, model_updated_at, created_at, updated_at
FROM ai_provider_credentials
WHERE organization_id = $1
  AND user_id = $2
ORDER BY provider;

-- name: GetProviderCredential :one
SELECT id, provider, label, base_url, secret_ciphertext, key_hint, model, model_updated_at, created_at, updated_at
FROM ai_provider_credentials
WHERE organization_id = $1
  AND user_id = $2
  AND provider = $3;

-- The same row, locked until the transaction ends: a save reads it to fill the
-- fields its request leaves out and writes them back, so two saves of one
-- credential (another tab, another browser) must queue instead of one writing
-- back what the other just replaced.
-- name: GetProviderCredentialForUpdate :one
SELECT id, provider, label, base_url, secret_ciphertext, key_hint, model, model_updated_at, created_at, updated_at
FROM ai_provider_credentials
WHERE organization_id = $1
  AND user_id = $2
  AND provider = $3
FOR UPDATE;

-- Create or replace one provider's credential. xmax = 0 is true only for a
-- freshly inserted row, so the caller can answer 201 or 200. model_set says
-- the request named a model (UNI-1240): model_updated_at moves only then.
-- name: UpsertProviderCredential :one
INSERT INTO ai_provider_credentials (
  id, organization_id, user_id, provider, label, base_url, secret_ciphertext, key_hint, created_by, created_by_kind,
  model, model_updated_at
) VALUES (
  sqlc.arg('id'), sqlc.arg('organization_id'), sqlc.arg('user_id'), sqlc.arg('provider'), sqlc.arg('label'),
  sqlc.arg('base_url'), sqlc.arg('secret_ciphertext'), sqlc.arg('key_hint'), sqlc.arg('created_by'),
  sqlc.arg('created_by_kind'), sqlc.arg('model'),
  CASE WHEN sqlc.arg('model_set')::boolean THEN now() END
)
ON CONFLICT (organization_id, user_id, provider) DO UPDATE SET
  label = EXCLUDED.label,
  base_url = EXCLUDED.base_url,
  secret_ciphertext = EXCLUDED.secret_ciphertext,
  key_hint = EXCLUDED.key_hint,
  model = EXCLUDED.model,
  model_updated_at = CASE WHEN sqlc.arg('model_set')::boolean THEN now()
                          ELSE ai_provider_credentials.model_updated_at END,
  updated_at = now()
RETURNING id, provider, label, base_url, key_hint, model, model_updated_at, created_at, updated_at,
  (xmax = 0)::boolean AS created;

-- Update label, base URL and model and keep the stored key: a PUT without
-- api_key on an existing credential.
-- name: UpdateProviderCredentialSettings :one
UPDATE ai_provider_credentials
SET label = sqlc.arg('label'),
    base_url = sqlc.arg('base_url'),
    model = sqlc.arg('model'),
    model_updated_at = CASE WHEN sqlc.arg('model_set')::boolean THEN now() ELSE model_updated_at END,
    updated_at = now()
WHERE organization_id = sqlc.arg('organization_id')
  AND user_id = sqlc.arg('user_id')
  AND provider = sqlc.arg('provider')
RETURNING id, provider, label, base_url, key_hint, model, model_updated_at, created_at, updated_at;

-- name: DeleteProviderCredential :one
DELETE FROM ai_provider_credentials
WHERE organization_id = $1
  AND user_id = $2
  AND provider = $3
RETURNING id;
