-- "I was invited with another address" (ADR 0047): a six-digit code mailed
-- to an address typed during a pending provider sign-in, keyed by the
-- ticket's hash and the address because the address may have no account.
-- The table is identity data with no organization, so no tenant line.

-- name: CreateSignInEmailClaim :one
INSERT INTO sign_in_email_claims (id, ticket_hash, email, code_hash, expires_at, created_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: LockSignInEmailClaims :exec
-- Serializes the sends of one ticket (keyed by its hash), so two at once
-- cannot both pass the resend gate below.
SELECT pg_advisory_xact_lock(hashtextextended('sign-in-email-claim:' || sqlc.arg(ticket_hash)::text, 0));

-- Newest claim of the ticket whatever the address or state: the resend gate,
-- so one ticket cannot spray codes across addresses.
-- name: GetLatestSignInEmailClaim :one
SELECT * FROM sign_in_email_claims
WHERE ticket_hash = $1
ORDER BY created_at DESC
LIMIT 1;

-- Single use, expiry and the attempt cap are decided here, as for
-- email_verification_codes. The row lock queues parallel guesses at one
-- code, so none of them reads a count the others have not raised yet.
-- name: GetActiveSignInEmailClaim :one
SELECT * FROM sign_in_email_claims
WHERE ticket_hash = $1 AND email = $2 AND used_at IS NULL AND expires_at > now() AND attempts < 5
ORDER BY created_at DESC
LIMIT 1
FOR UPDATE;

-- name: IncrementSignInEmailClaimAttempts :exec
UPDATE sign_in_email_claims SET attempts = attempts + 1 WHERE id = $1;

-- name: MarkSignInEmailClaimUsed :execrows
UPDATE sign_in_email_claims SET used_at = now() WHERE id = $1 AND used_at IS NULL;

-- name: DeleteExpiredSignInEmailClaims :exec
DELETE FROM sign_in_email_claims WHERE expires_at < now() - interval '1 hour';
