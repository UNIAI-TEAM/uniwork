CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_events_org_meter ON usage_events (organization_id, meter_key, occurred_at);
