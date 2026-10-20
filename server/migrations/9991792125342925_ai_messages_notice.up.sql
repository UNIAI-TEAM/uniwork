-- A turn answered by a code the client renders (no_sources) instead of stored text (UNI-1820).
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS notice TEXT;
