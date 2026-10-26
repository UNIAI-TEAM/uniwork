-- Meeting scribe S2 (UNI-2024, spec 2026-10-20-meeting-scribe-agent-design §4.3,
-- §6.2): a clerk marks one participant as the room's shared microphone (a
-- laptop in the middle of the table). The server mirrors it to the LiveKit
-- attribute uw.shared_mic, and the scribe diarizes that track.
ALTER TABLE meeting_participants ADD COLUMN IF NOT EXISTS shared_mic_at TIMESTAMPTZ;
ALTER TABLE meeting_participants ADD COLUMN IF NOT EXISTS shared_mic_by TEXT;
