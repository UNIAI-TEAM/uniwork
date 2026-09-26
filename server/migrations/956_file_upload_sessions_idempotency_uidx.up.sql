-- T1-Q8: an idempotency key is bound to actor pair + purpose + full scope.
-- COALESCE keeps NULL scope fields inside the key; user_avatar rows key on
-- the user scope, org rows on the tenant. This is a uniqueness guard, not a
-- lookup index: GetUploadSessionByIdempotencyKey already locks the candidate
-- before inserting a conflicting key.
CREATE UNIQUE INDEX CONCURRENTLY uidx_file_upload_sessions_idempotency
  ON file_upload_sessions (
    created_by_kind, created_by, purpose,
    COALESCE(organization_id, ''), COALESCE(workspace_id, ''), COALESCE(user_id, ''),
    idempotency_key
  );
