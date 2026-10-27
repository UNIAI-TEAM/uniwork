-- The email claim of a pending sign-in (ADR 0047) is read by its ticket: the
-- resend gate takes the ticket's newest claim, the code check its live one.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sign_in_email_claims_ticket
  ON sign_in_email_claims (ticket_hash, created_at DESC);
