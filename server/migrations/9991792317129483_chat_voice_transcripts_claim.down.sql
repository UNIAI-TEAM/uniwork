DELETE FROM chat_voice_transcripts WHERE status = 'pending';
ALTER TABLE chat_voice_transcripts
  DROP COLUMN IF EXISTS claimed_at,
  DROP COLUMN IF EXISTS status,
  ALTER COLUMN text DROP DEFAULT;
