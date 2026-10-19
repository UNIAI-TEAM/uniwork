-- BIGUP S1-b (UNI-1862): multipart upload sessions for files > 20 MiB.
-- No foreign keys (enforced by server/migrations/lint_test.go).

CREATE TABLE file_multipart_uploads (
    id                       TEXT PRIMARY KEY,
    organization_id          TEXT NOT NULL,
    workspace_id             TEXT NOT NULL,
    document_id              TEXT,
    file_id                  TEXT NOT NULL,
    file_upload_session_id   TEXT NOT NULL,
    created_by               TEXT NOT NULL,
    created_by_kind          TEXT NOT NULL,
    opened_via               TEXT NOT NULL,
    token_document_id        TEXT,
    storage_upload_id        TEXT NOT NULL,
    object_key               TEXT NOT NULL,
    filename                 TEXT NOT NULL,
    size_bytes               BIGINT NOT NULL CHECK (size_bytes > 0),
    part_size                BIGINT NOT NULL CHECK (part_size > 0),
    total_parts              INT NOT NULL CHECK (total_parts >= 1 AND total_parts <= 10000),
    title                    TEXT,
    parent_id                TEXT,
    visibility               TEXT,
    probe_head_sha256        TEXT NOT NULL,
    probe_tail_sha256        TEXT NOT NULL,
    cd_offset                BIGINT,
    cd_size                  BIGINT,
    status                   TEXT NOT NULL DEFAULT 'open',
    failure_code             TEXT,
    result_document_id       TEXT,
    result_version_upload_id TEXT,
    lease_owner              TEXT,
    lease_expires_at         TIMESTAMPTZ,
    expires_at               TIMESTAMPTZ NOT NULL,
    closed_at                TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT file_multipart_uploads_status_check CHECK (
        status IN ('open', 'validating', 'completed', 'aborted', 'expired', 'failed')
    ),
    CONSTRAINT file_multipart_uploads_opened_via_check CHECK (
        opened_via IN ('workspace', 'version', 'frame')
    ),
    CONSTRAINT file_multipart_uploads_actor_kind_check CHECK (
        created_by_kind IN ('human', 'agent', 'system')
    ),
    CONSTRAINT file_multipart_uploads_frame_scope_check CHECK (
        (opened_via = 'frame' AND token_document_id IS NOT NULL AND document_id = token_document_id)
        OR (opened_via = 'version' AND document_id IS NOT NULL AND token_document_id IS NULL)
        OR (opened_via = 'workspace' AND document_id IS NULL AND token_document_id IS NULL)
    ),
    CONSTRAINT file_multipart_uploads_cd_pair_check CHECK (
        (cd_offset IS NULL) = (cd_size IS NULL)
    ),
    CONSTRAINT file_multipart_uploads_closed_at_check CHECK (
        (status IN ('open', 'validating') AND closed_at IS NULL)
        OR (status IN ('completed', 'aborted', 'expired', 'failed') AND closed_at IS NOT NULL)
    )
);
