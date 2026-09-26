-- FileService technical metadata (T1b; spec 2026-09-22 §4.1). One row per
-- immutable object; bytes live in the storage the locator names. No business
-- owner, purpose or reference count here: the upload session records who
-- staged the file, and business tables hold file_id.
CREATE TABLE files (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT,
  storage           TEXT NOT NULL,
  bucket            TEXT,
  object_key        TEXT NOT NULL,
  object_version    TEXT,
  original_filename TEXT NOT NULL,
  content_type      TEXT,
  size_bytes        BIGINT,
  checksum_sha256   TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  ready_at          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,

  CONSTRAINT files_storage_check
    CHECK (storage IN ('local', 's3', 'minio')),
  CONSTRAINT files_status_check
    CHECK (status IN ('pending', 'processing', 'ready', 'failed', 'deleting', 'deleted')),
  -- ADR 0023: NULL is the account-avatar branch only; an empty tenant is never
  -- a file. The NOT NULL rule is lifted for this column alone and the binding
  -- of NULL to user_avatar is enforced on file_upload_sessions.
  CONSTRAINT files_organization_id_nonempty
    CHECK (organization_id IS NULL OR btrim(organization_id) <> ''),
  CONSTRAINT files_bucket_matches_storage
    CHECK ((storage = 'local' AND bucket IS NULL)
        OR (storage <> 'local' AND bucket IS NOT NULL AND btrim(bucket) <> '')),
  CONSTRAINT files_object_key_safe
    CHECK (object_key <> ''
       AND object_key NOT LIKE '/%'
       AND object_key !~ '(^|/)\.\.(/|$)'),
  CONSTRAINT files_original_filename_nonempty
    CHECK (btrim(original_filename) <> ''),
  CONSTRAINT files_size_bytes_nonneg
    CHECK (size_bytes IS NULL OR size_bytes >= 0),
  CONSTRAINT files_checksum_sha256_hex
    CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT files_metadata_is_object
    CHECK (jsonb_typeof(metadata) = 'object'),
  -- T1-Q2: ready needs verified content metadata; the checksum stays optional.
  CONSTRAINT files_ready_has_metadata
    CHECK (status <> 'ready'
        OR (content_type IS NOT NULL AND size_bytes IS NOT NULL AND ready_at IS NOT NULL)),
  -- T1-Q5/Q6: ready_at is the file-age anchor; once set the file is at or past
  -- ready, and it survives the later deleting/deleted states for reconcile.
  CONSTRAINT files_ready_at_after_ready
    CHECK (ready_at IS NULL OR status IN ('ready', 'deleting', 'deleted')),
  CONSTRAINT files_deleted_at_marks_terminal
    CHECK ((status = 'deleted') = (deleted_at IS NOT NULL))
);

COMMENT ON TABLE files IS
  'FileService technical metadata: one row per immutable object. Bytes live in the storage the locator names; business tables hold the file_id. Upload actor/scope/purpose live on file_upload_sessions, not here.';
COMMENT ON COLUMN files.id IS
  'Opaque ULID assigned when the intent is recorded, before any byte is stored. Business tables store it; nothing parses it.';
COMMENT ON COLUMN files.organization_id IS
  'Immutable tenant organization ID from an authorized context, written at intent creation and never changed. Required for organization files. NULL is reserved for the account-avatar branch (purpose user_avatar with user scope) authorized through the identity flow; it does not mean public access or an unknown tenant (ADR 0023). An empty string is rejected.';
COMMENT ON COLUMN files.storage IS
  'Storage provider code: local = API server filesystem root; s3 = Amazon S3; minio = MinIO at any deployment location, including localhost and Docker. Not a deployment environment and not browser localStorage.';
COMMENT ON COLUMN files.bucket IS
  'Object bucket for s3/minio, including locally hosted MinIO. NULL for local filesystem storage.';
COMMENT ON COLUMN files.object_key IS
  'Immutable object name within the bucket, or the relative path beneath the configured filesystem root for local storage. Server-generated; not a URL and not an absolute filesystem path.';
COMMENT ON COLUMN files.object_version IS
  'Object version ID where the storage backend supports versioning. NULL where versioning is absent or the object has no recorded version.';
COMMENT ON COLUMN files.original_filename IS
  'Sanitized upload-time name shared by every reference for display and download (T1-Q4: no rename after upload).';
COMMENT ON COLUMN files.content_type IS
  'MIME type verified from content; NULL while pending/processing and required once ready. Never the client-supplied Content-Type.';
COMMENT ON COLUMN files.size_bytes IS
  'Verified size in bytes; NULL until measured, required once ready.';
COMMENT ON COLUMN files.checksum_sha256 IS
  'Lowercase-hex SHA-256 of the bytes, stored only when a purpose policy requires it or a supplied digest was verified (T1-Q2). NULL is valid on ready files; a value is never an unverified client or provider claim.';
COMMENT ON COLUMN files.status IS
  'File lifecycle: pending, processing, ready, failed, deleting, deleted. Says whether bytes and metadata exist, not whether a module points at the file.';
COMMENT ON COLUMN files.metadata IS
  'Versioned technical attributes object (schema_version, width, height, duration_ms, page_count, codec, ...) that the service validates against an allowlist with type checks (T1-Q1). Never business data, owners, scopes or signed URLs.';
COMMENT ON COLUMN files.ready_at IS
  'When the file first became ready. The garbage-collection age anchor (T1-Q5/T1-Q6): set once and never moved by claim, cancel, unlink or metadata updates. GC never substitutes created_at or updated_at for it.';
COMMENT ON COLUMN files.created_at IS
  'Intent write time. Not the file-age anchor; that is ready_at.';
COMMENT ON COLUMN files.updated_at IS
  'Last write to the technical record.';
COMMENT ON COLUMN files.deleted_at IS
  'Tombstone time: set exactly when status becomes deleted, NULL on every live status. Kept for reconcile, never resurrected.';
