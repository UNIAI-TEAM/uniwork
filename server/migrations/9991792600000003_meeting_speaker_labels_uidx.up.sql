-- One row per label in a meeting; the agent's segments upsert against it.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_meeting_speaker_labels_key
  ON meeting_speaker_labels (meeting_id, label_key);
