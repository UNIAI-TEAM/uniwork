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

-- name: UpdateUserAvatar :one
UPDATE users SET avatar_url = $2, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: CreateGoogleUser :one
INSERT INTO users (id, email, display_name, avatar_url, google_id, email_verified_at)
VALUES ($1, $2, $3, $4, $5, now())
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

-- name: UpdateUserDisplayName :one
UPDATE users SET display_name = $2, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: SetUserMatrixUserID :one
UPDATE users SET matrix_user_id = $2, updated_at = now()
WHERE id = $1
RETURNING *;
