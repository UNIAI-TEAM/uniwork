-- The transcript row doubles as the claim on the one paid transcription
-- (UNI-1908 F2): a reader inserts it 'pending' in a short statement, calls the
-- vendor holding no connection, then fills it 'done'. A pending claim older
-- than the vendor call can last may be retaken (ChatService).
ALTER TABLE chat_voice_transcripts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'done'
    CONSTRAINT chat_voice_transcripts_status_check CHECK (status IN ('pending', 'done')),
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ALTER COLUMN text SET DEFAULT '';
