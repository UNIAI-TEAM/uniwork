CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_meeting_provider_events ON meeting_provider_events (provider_key, provider_event_id);
