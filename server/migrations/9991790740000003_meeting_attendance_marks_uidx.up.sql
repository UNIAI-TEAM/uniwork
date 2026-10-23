CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_meeting_attendance_marks_participant ON meeting_attendance_marks (meeting_id, participant_id);
