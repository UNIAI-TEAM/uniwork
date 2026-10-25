-- The LiveKit participant SID the run's agent joined with (UNI-2023 review):
-- a participant_left webhook closes the run only for that connection, so the
-- leave of an agent another one replaced (duplicate identity) closes nothing.
ALTER TABLE meeting_scribe_runs ADD COLUMN IF NOT EXISTS agent_participant_sid TEXT NOT NULL DEFAULT '';
