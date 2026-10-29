-- Restores the schema only (9991791524388000 plus the two columns of
-- 9991791705198089); the sealed keys the up migration dropped are not
-- recoverable. The owner unique index is not rebuilt here: an index is a
-- CONCURRENTLY single-statement file, and 9991791524388001's down uses IF EXISTS.
CREATE TABLE IF NOT EXISTS ai_provider_credentials (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  provider          TEXT NOT NULL,
  label             TEXT NOT NULL DEFAULT '',
  base_url          TEXT NOT NULL DEFAULT '',
  secret_ciphertext BYTEA NOT NULL,
  key_hint          TEXT NOT NULL,
  created_by        TEXT NOT NULL,
  created_by_kind   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  model             TEXT NOT NULL DEFAULT '',
  model_updated_at  TIMESTAMPTZ,

  CONSTRAINT ai_provider_credentials_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system'))
);

INSERT INTO features (key, name, kind, unit, category, meter_mode, sort_order) VALUES
  ('office.ai_byok', 'Khóa AI riêng cho Office', 'flag', NULL, 'ai', 'accumulate', 61)
ON CONFLICT (key) DO NOTHING;

INSERT INTO plan_features (plan_id, feature_key, enabled, quota_limit)
SELECT pf.plan_id, 'office.ai_byok', true, NULL
FROM plan_features pf
WHERE pf.feature_key = 'ai.tokens' AND pf.enabled
ON CONFLICT DO NOTHING;
