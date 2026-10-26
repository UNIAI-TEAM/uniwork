-- Meeting scribe S2 (UNI-2024, spec §6.3): one row per speaker label a
-- meeting's transcript carries, and whom a clerk assigned it to. label_key is
-- "<participant identity>:<stt session>:<provider label>" for a shared
-- microphone, or "upload:<transcription_id>:<label>" for an uploaded file
-- (parent spec, UNI-2001). A row is created unassigned when the first segment
-- with its label arrives; user_id or name, never both, once assigned. No
-- foreign key (migration lint): MeetingService resolves the meeting first.
CREATE TABLE meeting_speaker_labels (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  meeting_id      TEXT NOT NULL,
  label_key       TEXT NOT NULL,
  user_id         TEXT,
  name            TEXT NOT NULL DEFAULT '',
  created_by      TEXT NOT NULL,
  created_by_kind TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT meeting_speaker_labels_name_check CHECK (char_length(name) <= 120),
  CONSTRAINT meeting_speaker_labels_one_target_check CHECK (user_id IS NULL OR name = ''),
  CONSTRAINT meeting_speaker_labels_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system'))
);
