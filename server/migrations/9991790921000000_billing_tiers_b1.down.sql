DELETE FROM plan_features WHERE plan_id IN (SELECT id FROM plans WHERE code IN ('team', 'business'));
DELETE FROM plans WHERE code IN ('team', 'business');

UPDATE plan_features pf SET quota_limit = NULL, enabled = true
FROM plans p WHERE pf.plan_id = p.id AND p.code = 'starter';

UPDATE plan_features pf SET enabled = true
FROM plans p WHERE pf.plan_id = p.id AND p.code = 'starter' AND pf.feature_key = 'documents.public_links';
