-- DB đã chạy billing_tiers_b1 khi Starter còn tắt cờ; đồng bộ catalog miễn phí.
UPDATE plan_features pf SET enabled = true
FROM plans p
WHERE pf.plan_id = p.id
  AND p.code = 'starter'
  AND pf.feature_key IN (
    'meeting.recording',
    'meeting.ai_summary',
    'sso.oidc',
    'documents.public_links'
  );
