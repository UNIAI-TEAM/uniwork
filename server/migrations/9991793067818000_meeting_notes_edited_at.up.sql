-- UNI-2217: a note can be edited; NULL means it never was.
ALTER TABLE meeting_notes ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
