-- A phone caller's knock names the connection it came from (UNI-2029 fix
-- round 1): admission grants that one connection, a hang-up withdraws only
-- its own knock. The SID is LiveKit's random connection id, never the
-- caller's number or identity.
ALTER TABLE meeting_join_requests ADD COLUMN IF NOT EXISTS provider_participant_sid TEXT;
