-- UNI-1738: keep the newest ACTIVE row per (room_id, call_id) before the partial unique index.
UPDATE chat_voice_recordings r
SET status = 'FAILED', ended_at = COALESCE(r.ended_at, now())
WHERE r.status = 'ACTIVE' AND EXISTS (
  SELECT 1 FROM chat_voice_recordings n
  WHERE n.room_id = r.room_id AND n.call_id = r.call_id AND n.status = 'ACTIVE'
    AND (n.started_at, n.id) > (r.started_at, r.id)
);
