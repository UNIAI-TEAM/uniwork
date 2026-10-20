-- name: GetOrganizationAskModels :one
SELECT ask_uni_models FROM organizations WHERE id = $1;

-- name: GetOrganizationAskModelsForUpdate :one
-- SetAskModels reads the list it is about to change under the row lock, so the
-- audit row's before/after is true and a repeated save writes no second row.
SELECT ask_uni_models FROM organizations WHERE id = $1 FOR UPDATE;

-- name: SetOrganizationAskModels :exec
UPDATE organizations SET
  ask_uni_models = sqlc.arg(models)::text[],
  ask_uni_models_updated_by = sqlc.arg(actor_id)::text,
  ask_uni_models_updated_at = now(),
  updated_at = now()
WHERE id = sqlc.arg(id);
