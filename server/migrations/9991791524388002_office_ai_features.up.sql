-- Office AI entitlements (UNI-1008 GO-A7, ADR 0029). office.ai_byok gates
-- saving a personal provider key and the BYOK proxy; office.ai_cloud gates
-- the UniWork-paid cloud tools, which spend the existing ai.tokens meter.
-- Every plan that already grants ai.tokens grants both, so no tier loses AI
-- it had; a plan without AI stays without.
INSERT INTO features (key, name, kind, unit, category, meter_mode, sort_order) VALUES
  ('office.ai_byok', 'Khóa AI riêng cho Office', 'flag', NULL, 'ai', 'accumulate', 61),
  ('office.ai_cloud', 'Công cụ AI đám mây cho Office', 'flag', NULL, 'ai', 'accumulate', 62)
ON CONFLICT (key) DO NOTHING;

INSERT INTO plan_features (plan_id, feature_key, enabled, quota_limit)
SELECT pf.plan_id, f.key, true, NULL
FROM plan_features pf
CROSS JOIN (VALUES ('office.ai_byok'), ('office.ai_cloud')) AS f(key)
WHERE pf.feature_key = 'ai.tokens' AND pf.enabled
ON CONFLICT DO NOTHING;
