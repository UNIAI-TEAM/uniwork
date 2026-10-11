ALTER TABLE ai_provider_credentials
  DROP COLUMN IF EXISTS model_updated_at,
  DROP COLUMN IF EXISTS model;
