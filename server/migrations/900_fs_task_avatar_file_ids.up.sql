-- FS-C1 migration window columns for the task/avatar module (UNI-744,
-- placeholder number — the Advisor renumbers at merge).
--
-- attachments.file_id points at a FileService file when the row was written by
-- the file pipeline; NULL means the legacy storage path wrote it and
-- object_key is still the locator, so object_key must become nullable.
-- attachments.purpose records the upload purpose that produced the file so
-- claim can group staged rows correctly and each reference provider knows
-- which files it may hold.
ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS file_id TEXT,
  ADD COLUMN IF NOT EXISTS purpose TEXT,
  ALTER COLUMN object_key DROP NOT NULL;

ALTER TABLE attachments
  ADD CONSTRAINT attachments_purpose_check CHECK (
    purpose IS NULL OR purpose IN ('task_attachment', 'task_description_image', 'task_comment_attachment')
  );

COMMENT ON COLUMN attachments.file_id IS 'FileService file id (FS-C1); NULL = legacy storage row located by object_key.';
COMMENT ON COLUMN attachments.purpose IS 'FS-C1 upload purpose that produced the file; NULL for legacy rows.';
COMMENT ON COLUMN attachments.object_key IS 'Legacy storage locator; NULL for FileService rows located by file_id.';

-- users.avatar_file_id is the account avatar's FileService reference. The
-- account avatar sits above organizations, so its file carries a NULL
-- organization_id through the user_avatar purpose (T1-Q10); readers keep
-- working from avatar_url until the FileService path is wired.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_file_id TEXT;

COMMENT ON COLUMN users.avatar_file_id IS 'FileService file id of the account avatar; NULL = avatar_url (legacy or external) is the source.';
