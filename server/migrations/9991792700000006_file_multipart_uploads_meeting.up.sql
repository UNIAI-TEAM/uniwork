-- UNI-2001 fix round: a meeting_audio session records the meeting it was
-- opened for, so only its uploader can queue the recording, and only for
-- that meeting. No foreign key (migration lint).
ALTER TABLE file_multipart_uploads ADD COLUMN meeting_id TEXT;
ALTER TABLE file_multipart_uploads ADD CONSTRAINT file_multipart_uploads_meeting_check
  CHECK ((opened_via = 'meeting_audio') = (meeting_id IS NOT NULL));
