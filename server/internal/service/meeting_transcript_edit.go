package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A clerk corrects or removes what the transcript says (UNI-1995 #5): one
// line's text, one line, a stretch of time, the whole transcript, or an
// uploaded transcription together with its recording. Each command commits
// with its audit row and transcript.changed, and marks the meeting's
// summaries as made from a transcript that has changed since. Audit rows
// count lines; they never copy what was said, or a deletion would live on
// in the audit log.

// transcriptChanged is the tail every command shares, inside its transaction.
func (s *MeetingService) transcriptChanged(ctx context.Context, q *db.Queries, m db.Meeting, actor audit.Actor, action, resourceType, resourceID string, metadata map[string]any) error {
	if err := q.MarkMeetingSummariesTranscriptChanged(ctx, m.ID); err != nil {
		return err
	}
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["meeting_id"] = m.ID
	return auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID, Actor: actor, Action: action,
		ResourceType: resourceType, ResourceID: resourceID, Metadata: metadata,
	}, audit.Event{
		Topic: "transcript.changed", OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID,
		Payload: map[string]string{"meeting_id": m.ID, "workspace_id": m.WorkspaceID},
	})
}

// EditTranscriptSegment replaces one line's text. The first wording stays in
// original_text and the line shows it was edited.
func (s *MeetingService) EditTranscriptSegment(ctx context.Context, userID, meetingID, segmentID, text string) (db.MeetingTranscriptSegment, error) {
	m, err := s.requireMeetingClerk(ctx, userID, meetingID)
	if err != nil {
		return db.MeetingTranscriptSegment{}, err
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return db.MeetingTranscriptSegment{}, Invalid("nội dung không được để trống")
	}
	text = capRunes(text, transcriptSegmentRunes, "")
	var seg db.MeetingTranscriptSegment
	err = s.inTx(ctx, func(q *db.Queries) error {
		var err error
		seg, err = q.EditTranscriptSegment(ctx, db.EditTranscriptSegmentParams{ID: segmentID, MeetingID: m.ID, Text: text, EditedBy: strText(userID)})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		return s.transcriptChanged(ctx, q, m, audit.User(userID), audit.ActionMeetingTranscriptSegmentEdited, "meeting_transcript_segment", seg.ID,
			map[string]any{"runes": len([]rune(text))})
	})
	return seg, err
}

// DeleteTranscriptSegment removes one line.
func (s *MeetingService) DeleteTranscriptSegment(ctx context.Context, userID, meetingID, segmentID string) error {
	m, err := s.requireMeetingClerk(ctx, userID, meetingID)
	if err != nil {
		return err
	}
	return s.inTx(ctx, func(q *db.Queries) error {
		n, err := q.DeleteTranscriptSegment(ctx, db.DeleteTranscriptSegmentParams{ID: segmentID, MeetingID: m.ID})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return s.transcriptChanged(ctx, q, m, audit.User(userID), audit.ActionMeetingTranscriptSegmentDeleted, "meeting_transcript_segment", segmentID, nil)
	})
}

// DeleteTranscriptRange removes every line spoken in [from, to), whatever
// its source (an off-the-record stretch). It returns the lines removed.
func (s *MeetingService) DeleteTranscriptRange(ctx context.Context, userID, meetingID string, from, to time.Time) (int64, error) {
	m, err := s.requireMeetingClerk(ctx, userID, meetingID)
	if err != nil {
		return 0, err
	}
	if from.IsZero() || !to.After(from) {
		return 0, Invalid("to phải sau from")
	}
	var n int64
	err = s.inTx(ctx, func(q *db.Queries) error {
		var err error
		n, err = q.DeleteTranscriptSegmentsBetween(ctx, db.DeleteTranscriptSegmentsBetweenParams{
			MeetingID: m.ID, FromAt: pgtype.Timestamptz{Time: from, Valid: true}, ToAt: pgtype.Timestamptz{Time: to, Valid: true},
		})
		if err != nil || n == 0 {
			return err
		}
		return s.transcriptChanged(ctx, q, m, audit.User(userID), audit.ActionMeetingTranscriptRangeDeleted, "meeting", m.ID,
			map[string]any{"from": from.UTC().Format(time.RFC3339), "to": to.UTC().Format(time.RFC3339), "segments": n})
	})
	return n, err
}

// DeleteTranscript removes every line of the meeting, every source. Uploaded
// recordings stay until DeleteTranscription; summaries and minutes stay.
func (s *MeetingService) DeleteTranscript(ctx context.Context, userID, meetingID string) (int64, error) {
	m, err := s.requireMeetingClerk(ctx, userID, meetingID)
	if err != nil {
		return 0, err
	}
	var n int64
	err = s.inTx(ctx, func(q *db.Queries) error {
		var err error
		if n, err = q.DeleteMeetingTranscriptSegments(ctx, m.ID); err != nil {
			return err
		}
		return s.transcriptChanged(ctx, q, m, audit.User(userID), audit.ActionMeetingTranscriptDeleted, "meeting", m.ID,
			map[string]any{"segments": n})
	})
	return n, err
}

// DeleteTranscription removes an uploaded transcription that is done or
// failed, its lines, and its hold on the recording: the file collector then
// deletes the audio. A job still queued or running is refused (409).
func (s *MeetingService) DeleteTranscription(ctx context.Context, userID, meetingID, transcriptionID string) error {
	m, err := s.requireMeetingClerk(ctx, userID, meetingID)
	if err != nil {
		return err
	}
	return s.inTx(ctx, func(q *db.Queries) error {
		return s.deleteTranscriptionInTx(ctx, q, m, audit.User(userID), transcriptionID, "")
	})
}

func (s *MeetingService) deleteTranscriptionInTx(ctx context.Context, q *db.Queries, m db.Meeting, actor audit.Actor, transcriptionID, reason string) error {
	t, err := q.DeleteMeetingTranscription(ctx, db.DeleteMeetingTranscriptionParams{ID: transcriptionID, MeetingID: m.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		// Still queued or running in this meeting: the worker owns it.
		if t, gerr := q.GetMeetingTranscription(ctx, transcriptionID); gerr == nil && t.MeetingID == m.ID {
			return errInvalidState()
		}
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	n, err := q.DeleteTranscriptionSegments(ctx, db.DeleteTranscriptionSegmentsParams{MeetingID: m.ID, TranscriptionID: t.ID})
	if err != nil {
		return err
	}
	if s.files != nil {
		// A file already gone needs no release.
		var fe *files.Error
		if err := s.files.ReleaseInTx(ctx, q, []files.FileID{files.FileID(t.FileID)}); err != nil && !(errors.As(err, &fe) && fe.Code == files.CodeNotFound) {
			return err
		}
	}
	metadata := map[string]any{"file_id": t.FileID, "segments": n}
	if reason != "" {
		metadata["reason"] = reason
	}
	return s.transcriptChanged(ctx, q, m, actor, audit.ActionMeetingTranscriptionDeleted, "meeting_transcription", t.ID, metadata)
}

// transcriptRetentionDays is the closed set an organization picks from;
// no value keeps transcripts.
var transcriptRetentionDays = map[int32]bool{30: true, 90: true, 180: true, 365: true}

// SetMeetingTranscriptRetention sets how many days the organization keeps
// transcript lines and uploaded meeting audio; nil keeps them (the default).
func (s *MeetingService) SetMeetingTranscriptRetention(ctx context.Context, actor Actor, organizationID string, days *int32) (db.MeetingSetting, error) {
	if err := s.requireOrgAdmin(ctx, actor, organizationID); err != nil {
		return db.MeetingSetting{}, err
	}
	if days != nil && !transcriptRetentionDays[*days] {
		return db.MeetingSetting{}, Invalid("transcript_retention_days phải là 30, 90, 180, 365 hoặc null")
	}
	var set db.MeetingSetting
	err := s.inTx(ctx, func(q *db.Queries) error {
		before, err := q.GetMeetingSettings(ctx, organizationID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		next := pgtype.Int4{}
		if days != nil {
			next = pgtype.Int4{Int32: *days, Valid: true}
		}
		set, err = q.SetMeetingTranscriptRetention(ctx, db.SetMeetingTranscriptRetentionParams{
			OrganizationID: organizationID, Days: next, UpdatedBy: actor.ID, UpdatedByKind: string(actor.Kind),
		})
		if err != nil || before.TranscriptRetentionDays == next {
			return err
		}
		return auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: organizationID, Actor: actor, Action: audit.ActionMeetingSettingsChanged,
			ResourceType: "organization", ResourceID: organizationID,
			Changes: audit.Diff(map[string]any{"transcript_retention_days": retentionValue(before.TranscriptRetentionDays)},
				map[string]any{"transcript_retention_days": retentionValue(next)}),
		})
	})
	return set, err
}

func retentionValue(v pgtype.Int4) any {
	if !v.Valid {
		return nil
	}
	return v.Int32
}
