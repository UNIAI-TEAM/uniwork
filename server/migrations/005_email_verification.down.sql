DROP TABLE email_verification_codes;
ALTER TABLE users DROP COLUMN google_id;
ALTER TABLE users DROP COLUMN email_verified_at;
-- Dev-only rollback: rows without a password cannot satisfy NOT NULL.
DELETE FROM users WHERE password_hash IS NULL;
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
