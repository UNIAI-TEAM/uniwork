-- Which Claude models Ask UNI offers an organization (R14). NULL means the
-- default set (the models marked DefaultOn in service.askModels).
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS ask_uni_models TEXT[],
  ADD COLUMN IF NOT EXISTS ask_uni_models_updated_by TEXT,
  ADD COLUMN IF NOT EXISTS ask_uni_models_updated_at TIMESTAMPTZ;
