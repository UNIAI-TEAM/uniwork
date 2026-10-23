-- T1-Q8: an idempotency key is unique inside one organization whatever the
-- actor/purpose/workspace variant, so a replay carrying a different command
-- resolves to the stored session and answers idempotency_conflict instead of
-- silently creating a second upload. The personal-avatar branch has no tenant
-- and is covered by uidx_file_upload_sessions_avatar_idempotency; a global
-- key index is deliberately NOT used (cross-tenant key collision).
CREATE UNIQUE INDEX CONCURRENTLY uidx_file_upload_sessions_idempotency
  ON file_upload_sessions (organization_id, idempotency_key)
  WHERE organization_id IS NOT NULL;
