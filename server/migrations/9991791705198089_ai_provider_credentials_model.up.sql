-- UNI-1240: the model a person chose for a provider, saved with their
-- credential so every browser of the same account starts from it. '' means
-- none chosen; model_updated_at (NULL until a model is first set) picks the
-- default provider: the one whose model was set last.
ALTER TABLE ai_provider_credentials
  ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS model_updated_at TIMESTAMPTZ;
