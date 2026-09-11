UPDATE plan_features SET quota_limit = NULL
WHERE feature_key = 'ai.tokens' AND quota_limit = 500000;
