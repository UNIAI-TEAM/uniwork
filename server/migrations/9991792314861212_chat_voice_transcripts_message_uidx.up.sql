-- One transcript per voice message: the insert after a paid transcription
-- relies on it, and the lookup before one reads through it.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_chat_voice_transcripts_message
  ON chat_voice_transcripts (message_id);
