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

-- name: LockSignInEmailClaimAddress :exec
-- Serializes the sends and the guesses of one address, whichever ticket asks,
-- so the address's budget below is read by one of them at a time.
SELECT pg_advisory_xact_lock(hashtextextended('sign-in-email-claim-addr:' || sqlc.arg(email)::text, 0));

-- name: GetSignInEmailClaimBudget :one
-- An address's claims since the window opened, whichever ticket asked: the
-- codes it got, the wrong guesses they took (attempts counts only those), and
-- the oldest, the first to leave the window.
SELECT count(*)::int AS codes,
       COALESCE(sum(attempts), 0)::int AS wrong_guesses,
       COALESCE(min(created_at), now())::timestamptz AS oldest
FROM sign_in_email_claims
WHERE email = $1 AND created_at > $2;

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
-- A day of claims stays (each lives fifteen minutes): the address's budget
-- counts them.
DELETE FROM sign_in_email_claims WHERE created_at < now() - interval '1 day';
