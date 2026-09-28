CREATE UNIQUE INDEX CONCURRENTLY calendar_connections_user_provider_uidx
ON calendar_connections (organization_id, workspace_id, user_id, provider)
WHERE disconnected_at IS NULL;
