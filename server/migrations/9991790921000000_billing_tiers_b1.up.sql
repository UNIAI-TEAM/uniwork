-- OPEN_QUESTIONS B1: concrete free vs paid tiers (Starter / Team / Business).
-- Quota NULL = không giới hạn; flag enabled = false = tắt tính năng.

INSERT INTO plans (id, code, name, description, billing_period, price_amount, price_currency, is_default, is_active, sort_order)
SELECT '01K4F02PLANTEAM0000000001', 'team', 'Team', 'Nhóm nhỏ: họp, ghi hình, AI, liên kết tài liệu công khai', 'month', 499000, 'VND', false, true, 10
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE code = 'team');

INSERT INTO plans (id, code, name, description, billing_period, price_amount, price_currency, is_default, is_active, sort_order)
SELECT '01K4F02PLANBUSINESS00001', 'business', 'Business', 'Tổ chức lớn: SSO, dung lượng và phút họp cao hơn', 'month', 1499000, 'VND', false, true, 20
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE code = 'business');

-- Starter (miễn phí): giới hạn rõ ràng
UPDATE plan_features pf SET quota_limit = 5, enabled = true
FROM plans p WHERE pf.plan_id = p.id AND p.code = 'starter' AND pf.feature_key = 'members.max';

UPDATE plan_features pf SET quota_limit = 2, enabled = true
FROM plans p WHERE pf.plan_id = p.id AND p.code = 'starter' AND pf.feature_key = 'workspaces.max';

UPDATE plan_features pf SET quota_limit = 200, enabled = true
FROM plans p WHERE pf.plan_id = p.id AND p.code = 'starter' AND pf.feature_key = 'tasks.max';

UPDATE plan_features pf SET quota_limit = 3000, enabled = true
FROM plans p WHERE pf.plan_id = p.id AND p.code = 'starter' AND pf.feature_key = 'meeting.participant_minutes';

UPDATE plan_features pf SET quota_limit = 100000, enabled = true
FROM plans p WHERE pf.plan_id = p.id AND p.code = 'starter' AND pf.feature_key = 'ai.tokens';

UPDATE plan_features pf SET quota_limit = 5368709120, enabled = true
FROM plans p WHERE pf.plan_id = p.id AND p.code = 'starter' AND pf.feature_key = 'storage.bytes';

UPDATE plan_features pf SET enabled = false
FROM plans p WHERE pf.plan_id = p.id AND p.code = 'starter' AND pf.feature_key IN (
  'meeting.recording', 'meeting.ai_summary', 'sso.oidc', 'documents.public_links'
);

INSERT INTO plan_features (plan_id, feature_key, enabled, quota_limit)
SELECT p.id, 'tasks.max', true, 200
FROM plans p WHERE p.code = 'starter'
  AND NOT EXISTS (SELECT 1 FROM plan_features pf WHERE pf.plan_id = p.id AND pf.feature_key = 'tasks.max');

-- Team (499.000 ₫/tháng)
INSERT INTO plan_features (plan_id, feature_key, enabled, quota_limit)
SELECT p.id, v.feature_key, v.enabled, v.quota_limit
FROM plans p
CROSS JOIN (VALUES
  ('members.max', true, 30::bigint),
  ('workspaces.max', true, 10::bigint),
  ('tasks.max', true, NULL::bigint),
  ('meeting.participant_minutes', true, 30000::bigint),
  ('ai.tokens', true, 2000000::bigint),
  ('storage.bytes', true, 53687091200::bigint),
  ('meeting.recording', true, NULL::bigint),
  ('meeting.ai_summary', true, NULL::bigint),
  ('sso.oidc', false, NULL::bigint),
  ('documents.public_links', true, NULL::bigint)
) AS v(feature_key, enabled, quota_limit)
WHERE p.code = 'team'
ON CONFLICT (plan_id, feature_key) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  quota_limit = EXCLUDED.quota_limit;

-- Business (1.499.000 ₫/tháng)
INSERT INTO plan_features (plan_id, feature_key, enabled, quota_limit)
SELECT p.id, v.feature_key, v.enabled, v.quota_limit
FROM plans p
CROSS JOIN (VALUES
  ('members.max', true, 150::bigint),
  ('workspaces.max', true, NULL::bigint),
  ('tasks.max', true, NULL::bigint),
  ('meeting.participant_minutes', true, 150000::bigint),
  ('ai.tokens', true, 10000000::bigint),
  ('storage.bytes', true, 214748364800::bigint),
  ('meeting.recording', true, NULL::bigint),
  ('meeting.ai_summary', true, NULL::bigint),
  ('sso.oidc', true, NULL::bigint),
  ('documents.public_links', true, NULL::bigint)
) AS v(feature_key, enabled, quota_limit)
WHERE p.code = 'business'
ON CONFLICT (plan_id, feature_key) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  quota_limit = EXCLUDED.quota_limit;

-- Team/Business: mọi feature catalogue còn lại (bật, không trần nếu chưa liệt kê)
INSERT INTO plan_features (plan_id, feature_key, enabled, quota_limit)
SELECT p.id, f.key, true, NULL
FROM plans p
CROSS JOIN features f
WHERE p.code IN ('team', 'business')
  AND NOT EXISTS (
    SELECT 1 FROM plan_features pf WHERE pf.plan_id = p.id AND pf.feature_key = f.key
  );
