INSERT INTO plans (id, code, name, description, billing_period, price_amount, price_currency, is_default, is_active, sort_order)
SELECT '01K4F02PLANTEAMLOCAL00001', 'team_local', 'Team (local test)', 'Legacy dev checkout plan', 'month', 500000, 'VND', false, false, 10
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE code = 'team_local');

INSERT INTO plan_features (plan_id, feature_key, enabled, quota_limit)
SELECT p.id, f.key, true, NULL
FROM plans p CROSS JOIN features f
WHERE p.code = 'team_local'
ON CONFLICT DO NOTHING;
