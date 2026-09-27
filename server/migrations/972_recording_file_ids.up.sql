-- FS-C1 migration window columns for LiveKit egress recordings (UNI-746,
-- placeholder number — the Advisor renumbers at merge).
--
-- file_id points at a FileService file when the row was written by the
-- provider-output pipeline (RegisterProviderOutput before egress start,
-- CompleteProviderOutput + ClaimInTx at the finish webhook). NULL means the
-- legacy egress-to-S3 path wrote it and file_url is still the locator.
ALTER TABLE meeting_recordings
  ADD COLUMN IF NOT EXISTS file_id TEXT;

ALTER TABLE chat_voice_recordings
  ADD COLUMN IF NOT EXISTS file_id TEXT;

COMMENT ON COLUMN meeting_recordings.file_id IS 'FileService file id (FS-C1); NULL = legacy egress row located by file_url.';
COMMENT ON COLUMN meeting_recordings.file_url IS 'Legacy storage locator; NULL for FileService rows located by file_id.';
COMMENT ON COLUMN chat_voice_recordings.file_id IS 'FileService file id (FS-C1); NULL = legacy egress row located by file_url.';
COMMENT ON COLUMN chat_voice_recordings.file_url IS 'Legacy storage locator; NULL for FileService rows located by file_id.';
