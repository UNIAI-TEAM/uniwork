-- "I was invited with another address" is budgeted per address as well as
-- per ticket (ADR 0047): the budget counts the codes an address got, and the
-- wrong guesses they took, over the last day, whichever ticket asked.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sign_in_email_claims_email
  ON sign_in_email_claims (email, created_at DESC);
