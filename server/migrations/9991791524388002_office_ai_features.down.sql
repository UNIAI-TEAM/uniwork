DELETE FROM plan_features WHERE feature_key IN ('office.ai_byok', 'office.ai_cloud');
DELETE FROM features WHERE key IN ('office.ai_byok', 'office.ai_cloud');
