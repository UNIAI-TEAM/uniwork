-- Meeting scribe S2 (UNI-2024, spec 2026-10-20-meeting-scribe-agent-design
-- §4.3, §6.3): the shared microphone and the speaker labels of a meeting.

-- name: SetParticipantSharedMic :one
-- tenant: by-id
-- on = true stamps the first switch-on and keeps it; on = false clears it.
UPDATE meeting_participants SET
  shared_mic_at = CASE WHEN sqlc.arg('on')::bool THEN COALESCE(shared_mic_at, now()) ELSE NULL END,
  shared_mic_by = CASE WHEN sqlc.arg('on')::bool THEN COALESCE(shared_mic_by, sqlc.arg('by')::text) ELSE NULL END
WHERE id = sqlc.arg('id') AND status = 'ACTIVE'
RETURNING *;

-- name: InsertMeetingSpeakerLabel :execrows
-- The first segment carrying a label creates its row, unassigned; later
-- ones find it there.
INSERT INTO meeting_speaker_labels (id, organization_id, workspace_id, meeting_id, label_key, created_by, created_by_kind)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (meeting_id, label_key) DO NOTHING;

-- name: ListMeetingSpeakerLabels :many
-- tenant: parent meeting_id
-- Every label with its number in the meeting (order of first appearance,
-- "Người nói n"), the name it was given (a member's current display name, or
-- the free name) and its first line, so a clerk can tell who spoke it.
SELECT l.*,
  COALESCE(u.display_name, '')::text AS user_name,
  COALESCE(s.text, '')::text AS sample,
  s.spoken_at AS first_spoken_at
FROM (
  SELECT ml.*, row_number() OVER (ORDER BY ml.created_at, ml.id)::int AS number
  FROM meeting_speaker_labels ml WHERE ml.meeting_id = $1
) l
LEFT JOIN users u ON u.id = l.user_id
LEFT JOIN LATERAL (
  SELECT t.text, t.spoken_at FROM meeting_transcript_segments t
  WHERE t.meeting_id = l.meeting_id AND t.speaker_label = l.label_key
  ORDER BY t.spoken_at, t.id
  LIMIT 1
) s ON true
ORDER BY l.number
LIMIT 500;

-- name: GetMeetingSpeakerLabelView :one
-- tenant: parent meeting_id
-- One row of ListMeetingSpeakerLabels, for the answer to an assignment.
WITH numbered AS (
  SELECT ml.id, row_number() OVER (ORDER BY ml.created_at, ml.id)::int AS number
  FROM meeting_speaker_labels ml WHERE ml.meeting_id = sqlc.arg('meeting_id')
)
SELECT l.*, n.number,
  COALESCE(u.display_name, '')::text AS user_name,
  COALESCE((SELECT t.text FROM meeting_transcript_segments t
    WHERE t.meeting_id = l.meeting_id AND t.speaker_label = l.label_key
    ORDER BY t.spoken_at, t.id LIMIT 1), '')::text AS sample,
  (SELECT t.spoken_at FROM meeting_transcript_segments t
    WHERE t.meeting_id = l.meeting_id AND t.speaker_label = l.label_key
    ORDER BY t.spoken_at, t.id LIMIT 1)::timestamptz AS first_spoken_at
FROM meeting_speaker_labels l
JOIN numbered n ON n.id = l.id
LEFT JOIN users u ON u.id = l.user_id
WHERE l.id = sqlc.arg('id') AND l.meeting_id = sqlc.arg('meeting_id');

-- name: ListMeetingSpeakerNames :many
-- tenant: parent meeting_id
-- Every label's number and, when assigned, the name a transcript line shows.
SELECT l.label_key,
  row_number() OVER (ORDER BY l.created_at, l.id)::int AS number,
  COALESCE(NULLIF(l.name, ''), u.display_name, '')::text AS name
FROM meeting_speaker_labels l
LEFT JOIN users u ON u.id = l.user_id
WHERE l.meeting_id = $1;

-- name: LockMeetingSpeakerLabel :one
-- tenant: parent meeting_id
-- The row as it stands inside the assigning transaction.
SELECT * FROM meeting_speaker_labels WHERE id = sqlc.arg('id') AND meeting_id = sqlc.arg('meeting_id') FOR UPDATE;

-- name: AssignMeetingSpeakerLabel :one
-- tenant: by-id
UPDATE meeting_speaker_labels SET
  user_id = sqlc.narg('user_id'),
  name = sqlc.arg('name'),
  updated_at = now()
WHERE id = sqlc.arg('id')
RETURNING *;
