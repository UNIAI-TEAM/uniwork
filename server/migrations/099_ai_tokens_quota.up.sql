-- OPEN_QUESTIONS G2: 500k AI tokens per organization per month until billing
-- sets real tiers. Only plans that still say "unlimited" are touched, so a
-- tier the product owner already priced keeps its number.
UPDATE plan_features SET quota_limit = 500000
WHERE feature_key = 'ai.tokens' AND quota_limit IS NULL;
