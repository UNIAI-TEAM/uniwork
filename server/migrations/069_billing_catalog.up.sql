-- F-02: the plan catalogue is global, not tenant data (tenantExemptTables).
-- Feature keys are the vocabulary code calls Can()/CheckQuota() with; plan
-- codes never appear in code (scripts/no-plan-literal.test.mjs).
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  billing_period TEXT NOT NULL DEFAULT 'month',
  price_amount BIGINT,
  price_currency TEXT NOT NULL DEFAULT 'VND',
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS features (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('flag', 'quota')),
  unit TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  meter_mode TEXT NOT NULL DEFAULT 'accumulate' CHECK (meter_mode IN ('accumulate', 'snapshot')),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS plan_features (
  plan_id TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  quota_limit BIGINT,
  PRIMARY KEY (plan_id, feature_key)
);

INSERT INTO features (key, name, kind, unit, category, meter_mode, sort_order) VALUES
  ('members.max', 'Thành viên tổ chức', 'quota', 'members', 'organization', 'snapshot', 10),
  ('workspaces.max', 'Workspace', 'quota', 'workspaces', 'organization', 'snapshot', 20),
  ('meeting.participant_minutes', 'Phút tham dự họp', 'quota', 'minutes', 'meetings', 'accumulate', 30),
  ('meeting.recording', 'Ghi hình cuộc họp', 'flag', NULL, 'meetings', 'accumulate', 40),
  ('meeting.ai_summary', 'Tóm tắt họp bằng AI', 'flag', NULL, 'meetings', 'accumulate', 50),
  ('ai.tokens', 'Token AI', 'quota', 'tokens', 'ai', 'accumulate', 60),
  ('storage.bytes', 'Dung lượng lưu trữ', 'quota', 'bytes', 'documents', 'snapshot', 70),
  ('sso.oidc', 'Đăng nhập SSO (OIDC)', 'flag', NULL, 'security', 'accumulate', 80)
ON CONFLICT (key) DO NOTHING;

-- The default plan. Limits stay NULL (unlimited) until the product owner
-- fixes the tiers (OPEN_QUESTIONS B1); flags are on so nothing is blocked
-- before then.
INSERT INTO plans (id, code, name, description, billing_period, price_amount, is_default, sort_order)
SELECT '01K4F02PLAN0STARTER000000A', 'starter', 'Starter', 'Gói mặc định cho mọi tổ chức', 'none', 0, true, 0
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE code = 'starter');

INSERT INTO plan_features (plan_id, feature_key, enabled, quota_limit)
SELECT p.id, f.key, true, NULL FROM plans p CROSS JOIN features f WHERE p.code = 'starter'
ON CONFLICT DO NOTHING;
