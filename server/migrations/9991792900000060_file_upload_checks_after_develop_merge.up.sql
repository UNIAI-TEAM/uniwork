-- develop's 9991792710000050 restated these checks without meeting_audio, and
-- the runner applies a missing file whatever its prefix: on a database that
-- already ran 9991792900000006 it would refuse every meeting audio upload.
-- Restated once more with every value, so the order the two arrive in does
-- not matter.
ALTER TABLE file_upload_sessions DROP CONSTRAINT file_upload_sessions_purpose_check;
ALTER TABLE file_upload_sessions ADD CONSTRAINT file_upload_sessions_purpose_check
  CHECK (purpose IN ('user_avatar', 'task_attachment', 'task_description_image',
                     'task_comment_attachment', 'chat_attachment', 'chat_voice',
                     'chat_call_recording', 'meeting_recording', 'audit_export',
                     'document_file', 'document_asset', 'tenant_export',
                     'workspace_icon', 'chat_room_avatar', 'chat_link_preview',
                     'document_download', 'meeting_audio', 'chat_room_wallpaper'));

ALTER TABLE file_upload_sessions DROP CONSTRAINT file_upload_sessions_scope_matches_purpose;
ALTER TABLE file_upload_sessions ADD CONSTRAINT file_upload_sessions_scope_matches_purpose
  CHECK (
       (purpose = 'user_avatar'
        AND organization_id IS NULL AND workspace_id IS NULL AND user_id IS NOT NULL)
    OR (purpose IN ('audit_export', 'tenant_export', 'chat_link_preview')
        AND organization_id IS NOT NULL AND workspace_id IS NULL)
    OR (purpose IN ('task_attachment', 'task_description_image',
                    'task_comment_attachment', 'meeting_recording',
                    'document_file', 'document_asset', 'workspace_icon',
                    'document_download', 'meeting_audio')
        AND organization_id IS NOT NULL AND workspace_id IS NOT NULL)
    OR (purpose IN ('chat_attachment', 'chat_voice', 'chat_call_recording',
                    'chat_room_avatar', 'chat_room_wallpaper')
        AND organization_id IS NOT NULL)
  );
