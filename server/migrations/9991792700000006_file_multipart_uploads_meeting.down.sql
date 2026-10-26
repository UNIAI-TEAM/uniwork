ALTER TABLE file_multipart_uploads DROP CONSTRAINT IF EXISTS file_multipart_uploads_meeting_check;
ALTER TABLE file_multipart_uploads DROP COLUMN IF EXISTS meeting_id;
