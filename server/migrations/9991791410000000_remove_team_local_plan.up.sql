-- Drop legacy dev plan team_local (Stripe/PayOS sandbox); catalog uses team @ 499k.

UPDATE subscriptions s
SET plan_id = team.id, updated_at = now()
FROM plans legacy, plans team
WHERE legacy.code = 'team_local' AND team.code = 'team' AND s.plan_id = legacy.id;

UPDATE subscriptions s
SET overrides = overrides - 'scheduled_plan_code', updated_at = now()
FROM plans legacy
WHERE legacy.code = 'team_local'
  AND s.overrides->>'scheduled_plan_code' = 'team_local';

DELETE FROM plan_features
WHERE plan_id IN (SELECT id FROM plans WHERE code = 'team_local');

DELETE FROM plans WHERE code = 'team_local';
