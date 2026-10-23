ALTER TABLE users
  DROP COLUMN IF EXISTS apple_refresh_token_enc,
  DROP COLUMN IF EXISTS apple_client_id,
  DROP COLUMN IF EXISTS apple_id;
