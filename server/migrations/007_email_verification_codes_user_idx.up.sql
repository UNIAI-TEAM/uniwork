CREATE INDEX CONCURRENTLY idx_email_verification_codes_user ON email_verification_codes(user_id, created_at DESC);
