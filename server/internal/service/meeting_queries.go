package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const outboxWorkerTick = 2 * time.Second

type ProviderNeutralEvent struct {
	Type            string
	RoomName        string
	Identity        string
	ProviderEventID string
	RoomSID         string
	// ParticipantSID is the provider's id for one connection of Identity; a
	// reconnect keeps the identity and gets a new SID. Empty on old payloads.
	ParticipantSID string
	// OccurredAt is when the provider says the event happened; zero when it
	// did not say. Room sessions use it so a retried delivery keeps its time.
	OccurredAt time.Time
	// Recording fields are set for conference.recording_ended.
	RecordingID     string
	RecordingURL    string
	RecordingFailed bool
}

// HandleProviderEvent applies one provider webhook. Delivery is at least
// once: the event's ledger row (meeting_provider_events) commits in the same
// transaction as the change it makes, and a failure returns its error, so the
// inbox retries the event — and dead-letters it after webhookMaxAttempts —
// instead of losing it. A redelivered event finds its ledger row and changes
// nothing.
func (s *MeetingService) HandleProviderEvent(ctx context.Context, ev ProviderNeutralEvent) error {
	if ev.Type == "conference.recording_ended" {
		// The recording finish is idempotent (the finish queries gate on
		// ACTIVE/PROCESSING and the FS claim replays on OperationID), and a
		// webhook retry may reuse the provider event id — so it runs on every
		// delivery, and a row a transient fault left non-terminal can still
		// land. The ledger row only records that the event was seen.
		if ev.ProviderEventID != "" {
			if _, err := s.q.InsertProviderEvent(ctx, db.InsertProviderEventParams{
				ID: util.NewID(), ProviderKey: s.rt.ProviderKey, ProviderEventID: ev.ProviderEventID,
			}); err != nil {
				return err
			}
		}
		s.finishRecordingFromProvider(ctx, ev)
		return nil
	}
	sess, err := s.sessionByRoom(ctx, ev.RoomName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // no open conference for this room: nothing to apply
	}
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	// The ledger row first, then any lock the event takes: a concurrent copy
	// of the same event waits here for this transaction and then finds the
	// row, so the two never hold each other's locks.
	if ev.ProviderEventID != "" {
		n, err := q.InsertProviderEvent(ctx, db.InsertProviderEventParams{
			ID: util.NewID(), ProviderKey: s.rt.ProviderKey, ProviderEventID: ev.ProviderEventID,
		})
		if err != nil {
			return err
		}
		if n == 0 {
			return nil // a redelivery of an event already applied
		}
	}
	changed, err := s.applyRoomEvent(ctx, q, sess, ev)
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if changed {
		s.publishAttendanceChanged(ctx, sess.MeetingID)
	}
	if ev.Type == "conference.room_finished" {
		// Best effort: RunAutoEnd ends an overdue meeting on its next tick
		// anyway; this only spares an empty overtime room the wait.
		s.endIfOverdueEmpty(ctx, sess.MeetingID)
	}
	return nil
}

// applyRoomEvent makes the change one room webhook asks for, on the event's
// transaction. changed reports whether room sessions opened or closed, so the
// caller tells open attendance panels to refetch once it has committed.
func (s *MeetingService) applyRoomEvent(ctx context.Context, q *db.Queries, sess db.MeetingConferenceSession, ev ProviderNeutralEvent) (bool, error) {
	switch ev.Type {
	case "conference.room_started":
		_, err := q.MarkConferenceRoomStarted(ctx, db.MarkConferenceRoomStartedParams{
			ID: sess.ID, ProviderRoomSid: strText(ev.RoomSID), StartedAt: eventTime(ev),
		})
		return false, err
	case "conference.room_finished":
		n, err := q.MarkConferenceRoomFinished(ctx, db.MarkConferenceRoomFinishedParams{
			ID: sess.ID, EndedAt: eventTime(ev),
		})
		if err != nil || n == 0 {
			return false, err
		}
		closed, err := q.CloseOpenAttendanceForConference(ctx, db.CloseOpenAttendanceForConferenceParams{
			ConferenceSessionID: sess.ID, LeaveReason: strText("room_finished"), LeftAt: eventTime(ev),
		})
		return closed > 0, err
	case "conference.participant_joined":
		return s.roomParticipantJoined(ctx, q, sess, ev)
	case "conference.participant_left", "conference.participant_connection_aborted":
		return s.roomParticipantLeft(ctx, q, sess, ev)
	}
	return false, nil
}

func ptrTime(t time.Time) *time.Time { return &t }

func (s *MeetingService) sessionByRoom(ctx context.Context, room string) (db.MeetingConferenceSession, error) {
	// Room names are uw_mtg_{meetingID}; meeting id is the suffix.
	id := strings.TrimPrefix(room, "uw_mtg_")
	return s.q.GetOpenConferenceSession(ctx, id)
}

func (s *MeetingService) applyOutbox(ctx context.Context, row db.OutboxEvent) error {
	if s.provider == nil {
		return errors.New("conference provider not configured")
	}
	var p map[string]string
	if err := json.Unmarshal([]byte(row.Payload), &p); err != nil {
		return fmt.Errorf("outbox payload: %w", err)
	}
	switch row.Topic {
	case "provider.ensure_session":
		if s.ensureAlreadySettled(ctx, p["session_id"]) {
			return nil
		}
		ref, err := s.provider.EnsureSession(ctx, meetings.EnsureSessionRequest{
			MeetingID: p["meeting_id"], RoomName: p["room_name"], EmptyTimeout: s.rt.EmptyTimeout,
		})
		if sessionID := p["session_id"]; sessionID != "" {
			s.recordConferenceEnsure(ctx, sessionID, ref, err)
		}
		return err
	case "provider.remove_participant":
		return s.provider.RemoveParticipant(ctx, meetings.RemoveProviderParticipantRequest{
			RoomName: p["room_name"], Identity: p["identity"],
		})
	case "provider.end_session":
		return s.provider.EndSession(ctx, meetings.EndProviderSessionRequest{RoomName: p["room_name"]})
	default:
		return nil
	}
}

// ensureAlreadySettled reports whether a queued ensure has nothing left to
// do: Start and instant meetings also ensure inline, so the queued copy
// usually finds the session joinable already, and an ended session must not
// get its room back. An unreadable session is ensured as before.
func (s *MeetingService) ensureAlreadySettled(ctx context.Context, sessionID string) bool {
	if sessionID == "" {
		return false
	}
	sess, err := s.q.GetConferenceSession(ctx, sessionID)
	if err != nil {
		return false
	}
	return conferenceSessionReady(sess) || sess.Status == "ENDED"
}

// recordConferenceEnsure writes the outcome of a provider ensure. Both writes
// are conditional (MarkConferenceSessionEnsured / ...EnsureFailed): a failure
// never downgrades a session another ensure already made joinable, and a
// success never revives an ended one.
func (s *MeetingService) recordConferenceEnsure(ctx context.Context, sessionID string, ref meetings.ProviderSessionRef, err error) {
	if err != nil {
		_, _ = s.q.MarkConferenceSessionEnsureFailed(ctx, sessionID)
		return
	}
	sess, serr := s.q.MarkConferenceSessionEnsured(ctx, db.MarkConferenceSessionEnsuredParams{
		ID: sessionID, ProviderRoomSid: strText(ref.RoomSID),
	})
	if serr != nil {
		return
	}
	m, merr := s.q.GetMeeting(ctx, sess.MeetingID)
	if merr != nil {
		return
	}
	s.pub.Publish(ctx, m.WorkspaceID, Event{
		Type: "conference.session_ready",
		Payload: meetingRelatedPayload(m, map[string]string{
			"conference_session_id": sessionID,
		}),
	})
}

type MeetingListFilter struct {
	// Status is the status the viewer sees, not the stored one: "SCHEDULED"
	// is a scheduled meeting that can still start, "MISSED" one whose window
	// passed without it starting (displayMeetingStatus on the client).
	Status, MeetingType, HostUserID, ProjectID, Q string
	From, To                                      *time.Time
	Limit, Offset                                 int32
	// Sort is "" (newest created first), "actual_start_at" or "starts_at"
	// (calendar order around the viewer's today); the handler whitelists it.
	Sort string
	// Location is the viewer's zone for Sort "starts_at"; nil means UTC.
	Location *time.Location
}

func (s *MeetingService) ListFiltered(ctx context.Context, userID, workspaceID string, f MeetingListFilter) ([]db.ListMeetingsByWorkspaceFilteredRow, int64, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return nil, 0, err
	}
	if f.Limit <= 0 || f.Limit > 100 {
		f.Limit = 50
	}
	params := db.ListMeetingsByWorkspaceFilteredParams{
		WorkspaceID: workspaceID, Status: strText(f.Status), MeetingType: strText(f.MeetingType),
		HostUserID: strText(f.HostUserID), ProjectID: strText(f.ProjectID), Q: strText(f.Q),
		LimitN: f.Limit, OffsetN: f.Offset, Sort: f.Sort,
		// One instant for the page and its count, so a meeting whose window
		// closes between the two queries cannot be in one and not the other.
		Now: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}
	// The zone decides which calendar day "today" is and which day each
	// meeting falls on, so the pages cut the same day groups the client draws.
	loc := f.Location
	if loc == nil {
		loc = time.UTC
	}
	today := time.Now().In(loc)
	params.Tz = loc.String()
	params.Today = pgtype.Date{Time: time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC), Valid: true}
	if f.From != nil {
		params.FromAt = optTimestamptz(f.From)
	}
	if f.To != nil {
		params.ToAt = optTimestamptz(f.To)
	}
	rows, err := s.q.ListMeetingsByWorkspaceFiltered(ctx, params)
	if err != nil {
		return nil, 0, err
	}
	n, err := s.q.CountMeetingsByWorkspaceFiltered(ctx, db.CountMeetingsByWorkspaceFilteredParams{
		WorkspaceID: workspaceID, Status: params.Status, MeetingType: params.MeetingType,
		HostUserID: params.HostUserID, ProjectID: params.ProjectID, Q: params.Q,
		FromAt: params.FromAt, ToAt: params.ToAt, Now: params.Now,
	})
	return rows, n, err
}

// WorkspaceMeetingStats is served as-is; the tags are the contract with
// packages/core/types/meeting.ts (MeetingStatisticsSchema).
type WorkspaceMeetingStats struct {
	Total int64 `json:"total"`
	// Scheduled counts the meetings that can still start; Missed the
	// scheduled ones whose window passed. Together they are the stored
	// SCHEDULED rows, and each matches its list filter.
	Scheduled          int64   `json:"scheduled"`
	Missed             int64   `json:"missed"`
	InProgress         int64   `json:"in_progress"`
	Ended              int64   `json:"ended"`
	Canceled           int64   `json:"canceled"`
	Instant            int64   `json:"instant"`
	InvPending         int64   `json:"invitation_pending"`
	InvAccepted        int64   `json:"invitation_accepted"`
	InvDeclined        int64   `json:"invitation_declined"`
	InvTentative       int64   `json:"invitation_tentative"`
	JoinTotal          int64   `json:"join_request_total"`
	JoinApproved       int64   `json:"join_request_approved"`
	JoinRejected       int64   `json:"join_request_rejected"`
	AvgApprovalSeconds float64 `json:"avg_approval_seconds"`
	LinksCreated       int64   `json:"invite_links_created"`
	LinksUsed          int64   `json:"invite_links_used"`
	LinksRevoked       int64   `json:"invite_links_revoked"`
	LinksExpired       int64   `json:"invite_links_expired"`
}

func (s *MeetingService) Statistics(ctx context.Context, userID, workspaceID string) (WorkspaceMeetingStats, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return WorkspaceMeetingStats{}, err
	}
	ms, err := s.q.MeetingWorkspaceStatistics(ctx, db.MeetingWorkspaceStatisticsParams{
		WorkspaceID: workspaceID, Now: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		return WorkspaceMeetingStats{}, err
	}
	inv, _ := s.q.InvitationResponseBreakdown(ctx, workspaceID)
	jr, _ := s.q.JoinRequestStats(ctx, workspaceID)
	lk, _ := s.q.InviteLinkStats(ctx, workspaceID)
	return WorkspaceMeetingStats{
		Total: ms.Total, Scheduled: ms.Scheduled, Missed: ms.Missed, InProgress: ms.InProgress, Ended: ms.Ended,
		Canceled: ms.Canceled, Instant: ms.Instant,
		InvPending: inv.Pending, InvAccepted: inv.Accepted, InvDeclined: inv.Declined, InvTentative: inv.Tentative,
		JoinTotal: jr.Total, JoinApproved: jr.Approved, JoinRejected: jr.Rejected, AvgApprovalSeconds: jr.AvgApprovalSeconds,
		LinksCreated: lk.Created, LinksUsed: lk.Used, LinksRevoked: lk.Revoked, LinksExpired: lk.Expired,
	}, nil
}

func (s *MeetingService) Activity(ctx context.Context, userID, meetingID string, limit, offset int32) ([]db.MeetingAuditLog, error) {
	if _, _, err := s.authorize(ctx, userID, meetingID); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 50
	}
	return s.q.ListMeetingAuditLogs(ctx, db.ListMeetingAuditLogsParams{MeetingID: meetingID, Limit: limit, Offset: offset})
}

// publishAttendanceChanged tells open attendance panels to refetch after a
// webhook opened or closed a room session. Ephemeral: a lost frame only
// delays the refresh until the next one.
func (s *MeetingService) publishAttendanceChanged(ctx context.Context, meetingID string) {
	m, err := s.q.GetMeeting(ctx, meetingID)
	if err != nil {
		return
	}
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "attendance.updated", Payload: map[string]string{"meeting_id": meetingID}})
}
