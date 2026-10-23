-- T1-Q8/ADR 0023: on the identity branch (organization_id IS NULL) an
-- idempotency key is unique per uploader instead of per organization, so an
-- avatar upload replay resolves to the stored session the same way.
CREATE UNIQUE INDEX CONCURRENTLY uidx_file_upload_sessions_avatar_idempotency
  ON file_upload_sessions (created_by, idempotency_key)
  WHERE organization_id IS NULL;
