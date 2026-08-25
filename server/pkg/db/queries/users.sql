-- name: CreateUser :one
INSERT INTO users (id, email, password_hash, display_name)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: PatchUserOnboarding :one
UPDATE users SET
  onboarding_questionnaire = COALESCE(sqlc.narg('questionnaire'), onboarding_questionnaire),
  updated_at = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: MarkUserOnboarded :one
UPDATE users SET onboarded_at = COALESCE(onboarded_at, now()), updated_at = now()
WHERE id = $1
RETURNING *;
