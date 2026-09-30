CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_desktop_auth_attempts_code_digest ON desktop_auth_attempts(code_digest) WHERE code_digest IS NOT NULL;
