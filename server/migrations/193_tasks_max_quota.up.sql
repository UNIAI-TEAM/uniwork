-- Org-scoped task count meter for create-task quota (UNI-646). NULL on starter
-- keeps unlimited until product tiers are fixed (OPEN_QUESTIONS B1).
INSERT INTO features (key, name, kind, unit, category, meter_mode, sort_order) VALUES
  ('tasks.max', 'Số lượng task', 'quota', 'tasks', 'tasks', 'snapshot', 25)
ON CONFLICT (key) DO NOTHING;

INSERT INTO plan_features (plan_id, feature_key, enabled, quota_limit)
SELECT p.id, 'tasks.max', true, NULL
FROM plans p
WHERE p.code = 'starter'
ON CONFLICT DO NOTHING;
