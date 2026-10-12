-- Hồ sơ yêu cầu xuất dữ liệu tổ chức (C-06 lát 1, UNI-442).
-- Trạng thái là timestamp, cùng quy ước audit_exports. Không khóa ngoại.
CREATE TABLE data_subject_requests (
  id                 TEXT PRIMARY KEY,
  organization_id    TEXT NOT NULL,
  requested_by       TEXT NOT NULL,
  requested_by_kind  TEXT NOT NULL DEFAULT 'human',
  kind               TEXT NOT NULL DEFAULT 'export',
  row_count          INTEGER NOT NULL DEFAULT 0,
  file_id            TEXT,
  error              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  failed_at          TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,

  CONSTRAINT data_subject_requests_kind_check
    CHECK (kind IN ('export')),
  CONSTRAINT data_subject_requests_actor_kind_check
    CHECK (requested_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT data_subject_requests_ids_nonempty
    CHECK (id <> '' AND organization_id <> '' AND requested_by <> '')
);

-- tenant_export dùng cùng scope với audit_export: có tổ chức, không workspace.
ALTER TABLE file_upload_sessions DROP CONSTRAINT file_upload_sessions_purpose_check;
ALTER TABLE file_upload_sessions ADD CONSTRAINT file_upload_sessions_purpose_check
  CHECK (purpose IN ('user_avatar', 'task_attachment', 'task_description_image',
                     'task_comment_attachment', 'chat_attachment', 'chat_voice',
                     'chat_call_recording', 'meeting_recording', 'audit_export',
                     'document_file', 'document_asset', 'tenant_export'));

ALTER TABLE file_upload_sessions DROP CONSTRAINT file_upload_sessions_scope_matches_purpose;
ALTER TABLE file_upload_sessions ADD CONSTRAINT file_upload_sessions_scope_matches_purpose
  CHECK (
       (purpose = 'user_avatar'
        AND organization_id IS NULL AND workspace_id IS NULL AND user_id IS NOT NULL)
    OR (purpose IN ('audit_export', 'tenant_export')
        AND organization_id IS NOT NULL AND workspace_id IS NULL)
    OR (purpose IN ('task_attachment', 'task_description_image',
                    'task_comment_attachment', 'meeting_recording',
                    'document_file', 'document_asset')
        AND organization_id IS NOT NULL AND workspace_id IS NOT NULL)
    OR (purpose IN ('chat_attachment', 'chat_voice', 'chat_call_recording')
        AND organization_id IS NOT NULL)
  );
