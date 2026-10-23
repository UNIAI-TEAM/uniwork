-- The documents.public_links entitlement (C-01 §5.3; UNI-676 G1-02b). A flag
-- the plan grants; creating a link and every public read check it together
-- with the organization's own document_settings switch (default off). The
-- starter plan grants it, like tasks.max, until product tiers are fixed
-- (OPEN_QUESTIONS B1) - the organization switch still starts closed.
INSERT INTO features (key, name, kind, unit, category, meter_mode, sort_order) VALUES
  ('documents.public_links', 'Liên kết công khai cho tài liệu', 'flag', NULL, 'documents', 'accumulate', 75)
ON CONFLICT (key) DO NOTHING;

INSERT INTO plan_features (plan_id, feature_key, enabled, quota_limit)
SELECT p.id, 'documents.public_links', true, NULL
FROM plans p
WHERE p.code = 'starter'
ON CONFLICT DO NOTHING;
