-- Consent to AI processing (Apple 5.1.2(i)): before UniChat mobile sends a
-- conversation to the AI provider for the first time it names the provider
-- and what is sent, and records the person's answer here. The version is the
-- text the person agreed to; a client that shows a new text (another
-- provider, more data) asks again. NULL means never agreed or withdrawn.
ALTER TABLE users
  ADD COLUMN ai_consent_version TEXT,
  ADD COLUMN ai_consent_at      TIMESTAMPTZ;
