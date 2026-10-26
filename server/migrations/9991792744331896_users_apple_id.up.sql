-- Sign in with Apple (ADR 0041): the Apple subject an account is linked to,
-- and the refresh token Apple handed out for it, sealed, with the bundle id it
-- was issued to. Account deletion revokes that token (Apple requires it).
ALTER TABLE users
  ADD COLUMN apple_id TEXT,
  ADD COLUMN apple_client_id TEXT,
  ADD COLUMN apple_refresh_token_enc TEXT;
