-- name: CreateUser :one
INSERT INTO users (id, email, password_hash, display_name, locale)
VALUES ($1, $2, $3, $4, $5)
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

-- name: UpdateUserAvatar :one
UPDATE users SET avatar_url = $2, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: CreateGoogleUser :one
INSERT INTO users (id, email, display_name, avatar_url, google_id, email_verified_at, locale)
VALUES ($1, $2, $3, $4, $5, now(), $6)
RETURNING *;

-- name: GetUserByGoogleID :one
SELECT * FROM users WHERE google_id = $1;

-- name: LinkGoogleAccount :one
UPDATE users SET
  google_id = $2,
  email_verified_at = COALESCE(email_verified_at, now()),
  avatar_url = COALESCE(avatar_url, sqlc.narg('avatar_url')),
  updated_at = now()
WHERE id = $1
RETURNING *;

-- name: MarkEmailVerified :one
UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
WHERE id = $1
RETURNING *;

-- Nil arguments keep the current value, so one statement serves both
-- PATCH /me shapes and the two fields commit together.
-- name: UpdateUserProfile :one
UPDATE users SET
  display_name = COALESCE(sqlc.narg('display_name'), display_name),
  locale       = COALESCE(sqlc.narg('locale'), locale),
  updated_at   = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: UpdateUserPassword :one
UPDATE users SET password_hash = $2, updated_at = now()
WHERE id = $1
RETURNING *;
