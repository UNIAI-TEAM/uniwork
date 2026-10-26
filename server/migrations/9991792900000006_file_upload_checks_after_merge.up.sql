-- Two branches restated these checks in full at once: document_download
-- (9991792538903740) and opened_via 'folder' (9991792557228339) on develop,
-- meeting_audio (9991792700000005) on the meetings branch. The later file
-- won and dropped the other's values. Restated once more with every value,
-- as every purpose change before this did. chat_room_wallpaper (develop's
-- server wallpaper, f99e4b370) never reached these checks, so every
-- wallpaper upload failed them; it joins chat_room_avatar's scope branch.
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

ALTER TABLE file_multipart_uploads DROP CONSTRAINT file_multipart_uploads_opened_via_check;
ALTER TABLE file_multipart_uploads ADD CONSTRAINT file_multipart_uploads_opened_via_check CHECK (
  opened_via IN ('workspace', 'version', 'frame', 'folder', 'meeting_audio')
);

ALTER TABLE file_multipart_uploads DROP CONSTRAINT file_multipart_uploads_frame_scope_check;
ALTER TABLE file_multipart_uploads ADD CONSTRAINT file_multipart_uploads_frame_scope_check CHECK (
  (opened_via = 'frame' AND token_document_id IS NOT NULL AND document_id = token_document_id)
  OR (opened_via = 'version' AND document_id IS NOT NULL AND token_document_id IS NULL)
  OR (opened_via IN ('workspace', 'folder', 'meeting_audio') AND document_id IS NULL AND token_document_id IS NULL)
);
