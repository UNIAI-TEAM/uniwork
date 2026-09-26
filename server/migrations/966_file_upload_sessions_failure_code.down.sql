ALTER TABLE file_upload_sessions
  DROP CONSTRAINT IF EXISTS file_upload_sessions_failure_code_check,
  DROP COLUMN IF EXISTS failure_code;
