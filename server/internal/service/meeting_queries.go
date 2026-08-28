package service

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type ProviderNeutralEvent struct {
	Type            string
	RoomName        string
	Identity        string
	ProviderEventID string
	RoomSID         string
}

func (s *MeetingService) HandleProviderEvent(ctx context.Context, ev ProviderNeutralEvent) error {
	if ev.ProviderEventID != "" {
		n, err := s.q.InsertProviderEvent(ctx, db.InsertProviderEventParams{
			ID: util.NewID(), ProviderKey: s.rt.ProviderKey, ProviderEventID: ev.ProviderEventID,
		})
		if err != nil {
			return err
		}
		if n == 0 {
			return nil
		}
	}
	sess, err := s.sessionByRoom(ctx, ev.RoomName)
	if err != nil {
		return nil
	}
	switch ev.Type {
	case "conference.room_started":
		_, _ = s.q.UpdateConferenceSessionStatus(ctx, db.UpdateConferenceSessionStatusParams{
			ID: sess.ID, Status: strText("ACTIVE"), ProviderRoomSid: strText(ev.RoomSID),
			StartedAt: optTimestamptz(ptrTime(time.Now())),
		})
	case "conference.room_finished":
		_, _ = s.q.UpdateConferenceSessionStatus(ctx, db.UpdateConferenceSessionStatusParams{
			ID: sess.ID, Status: strText("IDLE"), EndedAt: optTimestamptz(ptrTime(time.Now())),
		})
	case "conference.participant_joined":
		pid := strings.TrimPrefix(ev.Identity, "uw_participant_")
		if pid == ev.Identity || pid == "" {
			return nil
		}
		if _, err := s.q.GetOpenAttendance(ctx, pid); err == nil {
			return nil
		}
		_, _ = s.q.OpenAttendanceSession(ctx, db.OpenAttendanceSessionParams{
			ID: util.NewID(), MeetingID: sess.MeetingID, ConferenceSessionID: sess.ID,
			ParticipantID: pid, ProviderParticipantIdentity: ev.Identity,
			ProviderEventID: strText(ev.ProviderEventID),
		})
	case "conference.participant_left", "conference.participant_connection_aborted":
		pid := strings.TrimPrefix(ev.Identity, "uw_participant_")
		open, err := s.q.GetOpenAttendance(ctx, pid)
		if err != nil {
			return nil
		}
		reason := "left"
		if ev.Type == "conference.participant_connection_aborted" {
			reason = "connection_aborted"
		}
		_, _ = s.q.CloseAttendanceSession(ctx, db.CloseAttendanceSessionParams{ID: open.ID, LeaveReason: strText(reason)})
	}
	return nil
}

func ptrTime(t time.Time) *time.Time { return &t }

func (s *MeetingService) sessionByRoom(ctx context.Context, room string) (db.MeetingConferenceSession, error) {
	// Room names are uw_mtg_{meetingID}; meeting id is the suffix.
	id := strings.TrimPrefix(room, "uw_mtg_")
	return s.q.GetOpenConferenceSession(ctx, id)
}

func (s *MeetingService) ProcessOutbox(ctx context.Context, limit int32) error {
	if s.pool == nil {
		return nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	rows, err := q.ListPendingOutbox(ctx, limit)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if err := s.applyOutbox(ctx, row); err != nil {
			_ = q.MarkOutboxFailed(ctx, db.MarkOutboxFailedParams{ID: row.ID, LastError: strText(err.Error())})
			continue
		}
		_ = q.MarkOutboxDone(ctx, row.ID)
	}
	return tx.Commit(ctx)
}

func (s *MeetingService) applyOutbox(ctx context.Context, row db.OutboxEvent) error {
	if s.provider == nil {
		return nil
	}
	var p map[string]string
	_ = json.Unmarshal([]byte(row.Payload), &p)
	switch row.Topic {
	case "provider.ensure_session":
		_, err := s.provider.EnsureSession(ctx, meetings.EnsureSessionRequest{
			MeetingID: p["meeting_id"], RoomName: p["room_name"], EmptyTimeout: s.rt.EmptyTimeout,
		})
		return err
	case "provider.remove_participant":
		return s.provider.RemoveParticipant(ctx, meetings.RemoveProviderParticipantRequest{
			RoomName: p["room_name"], Identity: p["identity"],
		})
	case "provider.end_session":
		return s.provider.EndSession(ctx, meetings.EndProviderSessionRequest{RoomName: p["room_name"]})
	}
	return nil
}

type MeetingListFilter struct {
	Status, MeetingType, HostUserID, ProjectID, Q string
	From, To                                      *time.Time
	Limit, Offset                                 int32
	Sort                                          string
}

func (s *MeetingService) ListFiltered(ctx context.Context, userID, workspaceID string, f MeetingListFilter) ([]db.Meeting, int64, error) {
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
	}
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
		FromAt: params.FromAt, ToAt: params.ToAt,
	})
	return rows, n, err
}

type WorkspaceMeetingStats struct {
	Total, Scheduled, InProgress, Ended, Canceled, Instant int64
	InvPending, InvAccepted, InvDeclined, InvTentative     int64
	JoinTotal, JoinApproved, JoinRejected                  int64
	AvgApprovalSeconds                                     float64
	LinksCreated, LinksUsed, LinksRevoked, LinksExpired    int64
}

func (s *MeetingService) Statistics(ctx context.Context, userID, workspaceID string) (WorkspaceMeetingStats, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return WorkspaceMeetingStats{}, err
	}
	ms, err := s.q.MeetingWorkspaceStatistics(ctx, workspaceID)
	if err != nil {
		return WorkspaceMeetingStats{}, err
	}
	inv, _ := s.q.InvitationResponseBreakdown(ctx, workspaceID)
	jr, _ := s.q.JoinRequestStats(ctx, workspaceID)
	lk, _ := s.q.InviteLinkStats(ctx, workspaceID)
	return WorkspaceMeetingStats{
		Total: ms.Total, Scheduled: ms.Scheduled, InProgress: ms.InProgress, Ended: ms.Ended,
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

func (s *MeetingService) MeetingCounts(ctx context.Context, userID, meetingID string) (db.MeetingListStatsRow, error) {
	if _, _, err := s.authorize(ctx, userID, meetingID); err != nil {
		return db.MeetingListStatsRow{}, err
	}
	return s.q.MeetingListStats(ctx, meetingID)
}

func (s *MeetingService) RunOutbox(ctx context.Context) {
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			_ = s.ProcessOutbox(ctx, 20)
		}
	}
}
