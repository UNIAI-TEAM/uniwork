-- UNI-2289: every Office editor AI call runs on UniWork AI; the personal
-- provider key store (ADR 0029) and its plan entitlement are gone. The keys
-- go with the table and cannot be restored by the down migration.
DELETE FROM plan_features WHERE feature_key = 'office.ai_byok';
DELETE FROM features WHERE key = 'office.ai_byok';
DROP TABLE IF EXISTS ai_provider_credentials;
