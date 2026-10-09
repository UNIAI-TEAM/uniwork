-- Per-user AI provider credentials (UNI-1008 GO-A7, ADR 0029). Rows are
-- personal, so every statement filters by organization_id and user_id
-- together; AICredentialService gates organization membership before it
-- calls any of these. The names carry no Ai prefix on purpose: internal/ai
-- may only call Ai* queries, and it must never read a stored key itself.

-- name: ListProviderCredentials :many
SELECT id, provider, label, base_url, key_hint, created_at, updated_at
FROM ai_provider_credentials
WHERE organization_id = $1
  AND user_id = $2
ORDER BY provider;

-- name: GetProviderCredential :one
SELECT id, provider, label, base_url, secret_ciphertext, key_hint, created_at, updated_at
FROM ai_provider_credentials
WHERE organization_id = $1
  AND user_id = $2
  AND provider = $3;

-- Create or replace one provider's credential. xmax = 0 is true only for a
-- freshly inserted row, so the caller can answer 201 or 200.
-- name: UpsertProviderCredential :one
INSERT INTO ai_provider_credentials (
  id, organization_id, user_id, provider, label, base_url, secret_ciphertext, key_hint, created_by, created_by_kind
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
)
ON CONFLICT (organization_id, user_id, provider) DO UPDATE SET
  label = EXCLUDED.label,
  base_url = EXCLUDED.base_url,
  secret_ciphertext = EXCLUDED.secret_ciphertext,
  key_hint = EXCLUDED.key_hint,
  updated_at = now()
RETURNING id, provider, label, base_url, key_hint, created_at, updated_at, (xmax = 0)::boolean AS created;

-- Update label and base URL and keep the stored key: a PUT without api_key on
-- an existing credential.
-- name: UpdateProviderCredentialSettings :one
UPDATE ai_provider_credentials
SET label = $4, base_url = $5, updated_at = now()
WHERE organization_id = $1
  AND user_id = $2
  AND provider = $3
RETURNING id, provider, label, base_url, key_hint, created_at, updated_at;

-- name: DeleteProviderCredential :one
DELETE FROM ai_provider_credentials
WHERE organization_id = $1
  AND user_id = $2
  AND provider = $3
RETURNING id;
