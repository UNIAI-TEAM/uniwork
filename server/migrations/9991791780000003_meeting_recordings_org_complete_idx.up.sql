-- Documents "other sources" (UNI-1305 item C): complete recordings backed by a
-- FileService file, newest first by the moment they ended (started when the
-- end was never recorded), the same expression the list sorts by.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_recordings_org_complete
  ON meeting_recordings (organization_id, (COALESCE(ended_at, started_at)) DESC, id COLLATE "C" DESC)
  WHERE status = 'COMPLETE' AND file_id IS NOT NULL;
