-- Meeting scribe (UNI-2023, spec 2026-10-20-meeting-scribe-agent-design §6.1):
-- one row per dispatch of the uniwork-scribe agent into a meeting's room. A
-- meeting can have many runs (D18: LiveKit ends the job when the room empties
-- and the sweep dispatches a new one when people come back). No foreign key
-- (migration lint): MeetingService resolves the meeting before it writes.
--
-- dispatched_at is when the current dispatch was sent: a run still DISPATCHED
-- 60 s later while people are in the room counts one failure. stt_session_ms
-- is the vendor session time the agent reports at the end, kept beside
-- speech_ms to check the vendor bill against the minutes metered (S0 §2.5).
CREATE TABLE meeting_scribe_runs (
  id                        TEXT PRIMARY KEY,
  organization_id           TEXT NOT NULL,
  workspace_id              TEXT NOT NULL,
  meeting_id                TEXT NOT NULL,
  dispatch_id               TEXT NOT NULL DEFAULT '',
  status                    TEXT NOT NULL DEFAULT 'DISPATCHED',
  failures                  INT NOT NULL DEFAULT 0,
  dispatched_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at                TIMESTAMPTZ,
  finished_at               TIMESTAMPTZ,
  speech_ms                 BIGINT NOT NULL DEFAULT 0,
  segments                  INT NOT NULL DEFAULT 0,
  metered_ms                BIGINT NOT NULL DEFAULT 0,
  stt_session_ms            BIGINT NOT NULL DEFAULT 0,
  extract_cursor_segment_id TEXT NOT NULL DEFAULT '',
  extracts                  INT NOT NULL DEFAULT 0,
  last_extract_at           TIMESTAMPTZ,
  created_by                TEXT NOT NULL,
  created_by_kind           TEXT NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT meeting_scribe_runs_status_check
    CHECK (status IN ('DISPATCHED', 'ACTIVE', 'FINISHED', 'FAILED')),
  CONSTRAINT meeting_scribe_runs_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system'))
);
