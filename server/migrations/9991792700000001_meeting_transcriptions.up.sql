-- Meetings follow-through đợt 5 (UNI-2001, parent spec §5.3): one row per
-- transcription of one uploaded recording. A meeting held without a room may
-- upload several parts; starts_at places second 0 of each file on the
-- meeting's clock (the actual start plus the parts before it), so segments of
-- every source share one time axis. The worker in MeetingService claims rows
-- with FOR UPDATE SKIP LOCKED and lease_until; attempts and next_attempt_at
-- drive its retries, deadline_at bounds one vendor job. estimated_seconds is
-- the size-based guess the request was charged against up front; it bounds
-- the job and places the next part until the vendor reports audio_seconds.
-- No foreign keys (migration lint): MeetingService resolves the meeting and
-- FileService the file.
CREATE TABLE meeting_transcriptions (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  meeting_id        TEXT NOT NULL,
  file_id           TEXT NOT NULL,
  filename          TEXT NOT NULL DEFAULT '',
  content_type      TEXT NOT NULL,
  size_bytes        BIGINT NOT NULL,
  estimated_seconds INT NOT NULL,
  starts_at         TIMESTAMPTZ NOT NULL,
  language          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'QUEUED',
  provider          TEXT NOT NULL DEFAULT '',
  model             TEXT NOT NULL DEFAULT '',
  provider_job_id   TEXT NOT NULL DEFAULT '',
  attempts          INT NOT NULL DEFAULT 0,
  lease_until       TIMESTAMPTZ,
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline_at       TIMESTAMPTZ,
  error_code        TEXT NOT NULL DEFAULT '',
  audio_seconds     INT,
  usage_event_id    TEXT,
  created_by        TEXT NOT NULL,
  created_by_kind   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  CONSTRAINT meeting_transcriptions_status_check
    CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETE', 'FAILED')),
  CONSTRAINT meeting_transcriptions_language_check CHECK (language IN ('vi', 'en')),
  CONSTRAINT meeting_transcriptions_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system'))
);
