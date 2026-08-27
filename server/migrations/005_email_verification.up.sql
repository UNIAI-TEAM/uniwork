-- Google-only users have no password; verification state is a timestamp.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN google_id TEXT;

-- Users that existed before verification was introduced are grandfathered.
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

-- One row per issued code; the code itself is stored as a sha256 hex digest.
-- No FK to users: the service deletes a user's codes when it verifies them.
CREATE TABLE email_verification_codes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
