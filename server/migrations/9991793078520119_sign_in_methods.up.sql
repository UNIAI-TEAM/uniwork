-- Unified sign-in (ADR 0047): one set of sign-in methods on every platform.
--
-- users: the provider address each link was made with, when it was made, and
-- the subject the owner unlinked (an unlinked identity is never relinked by
-- address); when the password last changed, when every older credential was
-- revoked, and the second-factor guess counter with its lockout.
ALTER TABLE users ADD COLUMN google_email TEXT;
ALTER TABLE users ADD COLUMN google_linked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN google_unlinked_sub TEXT;
ALTER TABLE users ADD COLUMN apple_email TEXT;
ALTER TABLE users ADD COLUMN apple_linked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN apple_unlinked_sub TEXT;
ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN credentials_revoked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN second_factor_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN second_factor_locked_until TIMESTAMPTZ;

-- A mailed six-digit code proves the mailbox for one purpose: verifying the
-- address, or a step-up proof for the action it names.
ALTER TABLE email_verification_codes ADD COLUMN purpose TEXT NOT NULL DEFAULT 'verify_email'
  CHECK (purpose IN ('verify_email', 'step_up'));
ALTER TABLE email_verification_codes ADD COLUMN action TEXT;

-- Links made before this migration were made with the account's address.
-- The linked-at time stays NULL: nobody recorded it.
UPDATE users SET google_email = email WHERE google_id IS NOT NULL AND google_email IS NULL;
UPDATE users SET apple_email = email WHERE apple_id IS NOT NULL AND apple_email IS NULL;

-- "I was invited with another address": a code mailed to an address that may
-- have no account yet, so it is keyed by the pending sign-in ticket and the
-- address, not by a user. No index beyond the key; one would come in its own
-- CONCURRENTLY file.
CREATE TABLE sign_in_email_claims (
  id           TEXT PRIMARY KEY,
  ticket_hash  TEXT NOT NULL, -- sha256 of the pending ticket
  email        TEXT NOT NULL, -- lower + trim
  code_hash    TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
