-- Where a meeting happens (UNI-2247):
-- online     people join the meeting's room (the behaviour before this column,
--            and the default);
-- in_person  people meet in a physical room and one device records the audio.
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS venue TEXT NOT NULL DEFAULT 'online';
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_venue_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_venue_check
  CHECK (venue IN ('online', 'in_person'));
