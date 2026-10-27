-- develop's 9991792710000001 (chat_room_wallpaper, UNI-923) first restated
-- these checks without meeting_audio and ai_attachment, and it reached develop
-- after 9991792900000090 had restated every value. The runner applies a
-- missing file whatever its prefix, so a database that ran 090 first and held
-- no session of either purpose ran that body after it, and meeting audio and
-- Ask UNI attachment uploads answered 500. #474 made 710000001 a no-op, which
-- repairs nothing on such a database. Restated with every value.
ALTER TABLE file_upload_sessions DROP CONSTRAINT file_upload_sessions_purpose_check;
ALTER TABLE file_upload_sessions ADD CONSTRAINT file_upload_sessions_purpose_check
  CHECK (purpose IN ('user_avatar', 'task_attachment', 'task_description_image',
                     'task_comment_attachment', 'chat_attachment', 'chat_voice',
                     'chat_call_recording', 'meeting_recording', 'audit_export',
                     'document_file', 'document_asset', 'tenant_export',
                     'workspace_icon', 'chat_room_avatar', 'chat_link_preview',
                     'document_download', 'meeting_audio', 'chat_room_wallpaper',
                     'ai_attachment'));

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
                    'document_download', 'meeting_audio', 'ai_attachment')
        AND organization_id IS NOT NULL AND workspace_id IS NOT NULL)
    OR (purpose IN ('chat_attachment', 'chat_voice', 'chat_call_recording',
                    'chat_room_avatar', 'chat_room_wallpaper')
        AND organization_id IS NOT NULL)
  );
