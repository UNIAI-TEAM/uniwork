package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type MeetingService struct {
	q   *db.Queries
	ws  *WorkspaceService
	pub EventPublisher
}

func NewMeetingService(q *db.Queries, ws *WorkspaceService, pub EventPublisher) *MeetingService {
	return &MeetingService{q: q, ws: ws, pub: pub}
}

type CreateMeetingInput struct {
	Title       string
	Description string
	StartsAt    time.Time
	EndsAt      time.Time
}

type UpdateMeetingInput struct {
	Title       *string
	Description *string
	StartsAt    *time.Time
	EndsAt      *time.Time
}

func optTimestamptz(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

func (s *MeetingService) Create(ctx context.Context, userID, workspaceID string, in CreateMeetingInput) (db.Meeting, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return db.Meeting{}, err
	}
	if strings.TrimSpace(in.Title) == "" {
		return db.Meeting{}, Invalid("tiêu đề không được để trống")
	}
	if !in.EndsAt.After(in.StartsAt) {
		return db.Meeting{}, Invalid("thời gian kết thúc phải sau thời gian bắt đầu")
	}
	id := util.NewID()
	m, err := s.q.CreateMeeting(ctx, db.CreateMeetingParams{
		ID: id, WorkspaceID: workspaceID,
		Title: strings.TrimSpace(in.Title), Description: in.Description,
		StartsAt: pgtype.Timestamptz{Time: in.StartsAt, Valid: true},
		EndsAt:   pgtype.Timestamptz{Time: in.EndsAt, Valid: true},
		RoomName: "uniwork-" + id, CreatedBy: userID,
	})
	if err != nil {
		return db.Meeting{}, err
	}
	if err := s.q.AddMeetingAttendee(ctx, db.AddMeetingAttendeeParams{MeetingID: id, UserID: userID}); err != nil {
		return db.Meeting{}, err
	}
	s.pub.Publish(ctx, workspaceID, Event{Type: "meeting.created", Payload: map[string]string{"meeting_id": id}})
	return m, nil
}

func (s *MeetingService) List(ctx context.Context, userID, workspaceID string) ([]db.Meeting, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	return s.q.ListMeetingsByWorkspace(ctx, workspaceID)
}

func (s *MeetingService) authorize(ctx context.Context, userID, meetingID string) (db.Meeting, error) {
	m, err := s.q.GetMeeting(ctx, meetingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, ErrNotFound
	}
	if err != nil {
		return db.Meeting{}, err
	}
	if _, err := s.ws.RequireMember(ctx, m.WorkspaceID, userID); err != nil {
		return db.Meeting{}, err
	}
	return m, nil
}

func (s *MeetingService) Get(ctx context.Context, userID, meetingID string) (db.Meeting, error) {
	return s.authorize(ctx, userID, meetingID)
}

func (s *MeetingService) Update(ctx context.Context, userID, meetingID string, in UpdateMeetingInput) (db.Meeting, error) {
	if _, err := s.authorize(ctx, userID, meetingID); err != nil {
		return db.Meeting{}, err
	}
	if in.Title != nil && strings.TrimSpace(*in.Title) == "" {
		return db.Meeting{}, Invalid("tiêu đề không được để trống")
	}
	m, err := s.q.UpdateMeeting(ctx, db.UpdateMeetingParams{
		ID: meetingID, Title: optText(in.Title), Description: optText(in.Description),
		StartsAt: optTimestamptz(in.StartsAt), EndsAt: optTimestamptz(in.EndsAt),
	})
	if err != nil {
		return db.Meeting{}, err
	}
	if !m.EndsAt.Time.After(m.StartsAt.Time) {
		return db.Meeting{}, Invalid("thời gian kết thúc phải sau thời gian bắt đầu")
	}
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "meeting.updated", Payload: map[string]string{"meeting_id": m.ID}})
	return m, nil
}

func (s *MeetingService) Delete(ctx context.Context, userID, meetingID string) error {
	m, err := s.authorize(ctx, userID, meetingID)
	if err != nil {
		return err
	}
	if err := s.q.DeleteMeeting(ctx, meetingID); err != nil {
		return err
	}
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "meeting.deleted", Payload: map[string]string{"meeting_id": meetingID}})
	return nil
}

func (s *MeetingService) AddNote(ctx context.Context, userID, meetingID, body string) (db.MeetingNote, error) {
	if _, err := s.authorize(ctx, userID, meetingID); err != nil {
		return db.MeetingNote{}, err
	}
	if strings.TrimSpace(body) == "" {
		return db.MeetingNote{}, Invalid("nội dung không được để trống")
	}
	return s.q.CreateMeetingNote(ctx, db.CreateMeetingNoteParams{
		ID: util.NewID(), MeetingID: meetingID, AuthorID: userID, Body: body,
	})
}

func (s *MeetingService) Notes(ctx context.Context, userID, meetingID string) ([]db.ListMeetingNotesRow, error) {
	if _, err := s.authorize(ctx, userID, meetingID); err != nil {
		return nil, err
	}
	return s.q.ListMeetingNotes(ctx, meetingID)
}
