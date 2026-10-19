ALTER TABLE organizations
  DROP COLUMN IF EXISTS ask_uni_models,
  DROP COLUMN IF EXISTS ask_uni_models_updated_by,
  DROP COLUMN IF EXISTS ask_uni_models_updated_at;
