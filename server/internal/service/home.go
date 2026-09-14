package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Home source names reported in HomeSummary.Partial when one of them fails.
const (
	HomeSourceTasks    = "tasks"
	HomeSourceMeetings = "meetings"
)

const (
	defaultHomeTaskLimit    = 8
	maxHomeTaskLimit        = 20
	defaultHomeMeetingLimit = 5
	maxHomeMeetingLimit     = 10
	maxHomePrefsBytes       = 8 << 10
	homeDefaultTimezone     = "Asia/Ho_Chi_Minh"
)

// HomeService reads the workspace home screen for one person: the open work
// assigned to them, the meetings they are part of today and tomorrow, and
// their layout preferences. It only reads other domains' tables; the one row
// it writes is the person's own display setting, which is not audited.
type HomeService struct {
	q   *db.Queries
	ws  *WorkspaceService
	now func() time.Time
	log *slog.Logger
}

func NewHomeService(q *db.Queries, ws *WorkspaceService) *HomeService {
	return &HomeService{q: q, ws: ws, now: time.Now, log: slog.Default()}
}

// HomeLimits caps the lists; zero means the default.
type HomeLimits struct {
	Tasks    int32
	Meetings int32
}

type HomeCounts struct {
	Open          int64
	Overdue       int64
	DueToday      int64
	MeetingsToday int64
}

// HomeSummary is one read of the home screen. "Today" is the calendar day in
// the person's time zone. A source that failed is empty and named in Partial;
// the rest of the summary is still valid.
type HomeSummary struct {
	Today       string
	Timezone    string
	Counts      HomeCounts
	MyWork      []db.Task
	Meetings    []db.Meeting
	Partial     []string
	GeneratedAt time.Time
}

type HomePreferenceView struct {
	Prefs     json.RawMessage
	UpdatedAt pgtype.Timestamptz
}

func clampHomeLimit(v, def, max int32) int32 {
	if v <= 0 {
		return def
	}
	if v > max {
		return max
	}
	return v
}

// homeLocation resolves the person's zone. An empty or unknown zone falls back
// to the product default, the same one users.timezone is created with.
func homeLocation(tz string) (*time.Location, string) {
	if tz != "" {
		if loc, err := time.LoadLocation(tz); err == nil {
			return loc, tz
		}
	}
	if loc, err := time.LoadLocation(homeDefaultTimezone); err == nil {
		return loc, homeDefaultTimezone
	}
	return time.UTC, "UTC"
}

// member gates every home read and write: workspace membership, and a human
// caller, since the screen and its preferences belong to a person.
func (s *HomeService) member(ctx context.Context, actor Actor, workspaceID string) (db.Workspace, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.Workspace{}, err
	}
	if actor.Kind != audit.KindHuman {
		return db.Workspace{}, ErrForbidden
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Workspace{}, ErrNotFound
	}
	return ws, err
}

func (s *HomeService) Summary(ctx context.Context, actor Actor, workspaceID string, lim HomeLimits) (HomeSummary, error) {
	ws, err := s.member(ctx, actor, workspaceID)
	if err != nil {
		return HomeSummary{}, err
	}
	user, err := s.q.GetUserByID(ctx, actor.ID)
	if err != nil {
		return HomeSummary{}, err
	}
	loc, tzName := homeLocation(user.Timezone)
	now := s.now()
	y, m, d := now.In(loc).Date()
	startToday := time.Date(y, m, d, 0, 0, 0, 0, loc)
	out := HomeSummary{
		Today:       startToday.Format("2006-01-02"),
		Timezone:    tzName,
		MyWork:      []db.Task{},
		Meetings:    []db.Meeting{},
		Partial:     []string{},
		GeneratedAt: now.UTC(),
	}
	today := pgtype.Date{Time: time.Date(y, m, d, 0, 0, 0, 0, time.UTC), Valid: true}

	if err := s.loadMyWork(ctx, ws, actor.ID, today, clampHomeLimit(lim.Tasks, defaultHomeTaskLimit, maxHomeTaskLimit), &out); err != nil {
		if ctx.Err() != nil {
			return HomeSummary{}, ctx.Err()
		}
		s.log.WarnContext(ctx, "home: my work source failed", "workspace_id", ws.ID, "user_id", actor.ID, "err", err)
		out.MyWork = []db.Task{}
		out.Counts.Open, out.Counts.Overdue, out.Counts.DueToday = 0, 0, 0
		out.Partial = append(out.Partial, HomeSourceTasks)
	}

	span := homeMeetingSpan{
		from: startToday, todayEnd: startToday.AddDate(0, 0, 1), to: startToday.AddDate(0, 0, 2),
	}
	if err := s.loadMeetings(ctx, ws.ID, actor.ID, span, clampHomeLimit(lim.Meetings, defaultHomeMeetingLimit, maxHomeMeetingLimit), &out); err != nil {
		if ctx.Err() != nil {
			return HomeSummary{}, ctx.Err()
		}
		s.log.WarnContext(ctx, "home: meetings source failed", "workspace_id", ws.ID, "user_id", actor.ID, "err", err)
		out.Meetings = []db.Meeting{}
		out.Counts.MeetingsToday = 0
		out.Partial = append(out.Partial, HomeSourceMeetings)
	}
	return out, nil
}

func (s *HomeService) loadMyWork(ctx context.Context, ws db.Workspace, userID string, today pgtype.Date, limit int32, out *HomeSummary) error {
	assignee := pgtype.Text{String: userID, Valid: true}
	rows, err := s.q.ListHomeMyWork(ctx, db.ListHomeMyWorkParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: ws.ID, UserID: assignee, Today: today, LimitN: limit,
	})
	if err != nil {
		return err
	}
	counts, err := s.q.CountHomeMyWork(ctx, db.CountHomeMyWorkParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: ws.ID, UserID: assignee, Today: today,
	})
	if err != nil {
		return err
	}
	out.MyWork = rows
	out.Counts.Open, out.Counts.Overdue, out.Counts.DueToday = counts.Open, counts.Overdue, counts.DueToday
	return nil
}

// homeMeetingSpan is [from, to) for the list — today and tomorrow — and
// [from, todayEnd) for the "meetings today" count.
type homeMeetingSpan struct{ from, todayEnd, to time.Time }

func (s *HomeService) loadMeetings(ctx context.Context, workspaceID, userID string, span homeMeetingSpan, limit int32, out *HomeSummary) error {
	ts := func(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }
	rows, err := s.q.ListHomeMeetings(ctx, db.ListHomeMeetingsParams{
		WorkspaceID: workspaceID, FromAt: ts(span.from), ToAt: ts(span.to), UserID: userID, LimitN: limit,
	})
	if err != nil {
		return err
	}
	today, err := s.q.CountHomeMeetingsToday(ctx, db.CountHomeMeetingsTodayParams{
		WorkspaceID: workspaceID, FromAt: ts(span.from), ToAt: ts(span.todayEnd), UserID: userID,
	})
	if err != nil {
		return err
	}
	out.Meetings = rows
	out.Counts.MeetingsToday = today
	return nil
}

// GetPreference returns the stored layout, or an empty object when the person
// never changed it; the client fills every missing key with its default.
func (s *HomeService) GetPreference(ctx context.Context, actor Actor, workspaceID string) (HomePreferenceView, error) {
	ws, err := s.member(ctx, actor, workspaceID)
	if err != nil {
		return HomePreferenceView{}, err
	}
	pref, err := s.q.GetHomePreference(ctx, db.GetHomePreferenceParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: ws.ID, UserID: actor.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return HomePreferenceView{Prefs: json.RawMessage("{}")}, nil
	}
	if err != nil {
		return HomePreferenceView{}, err
	}
	return HomePreferenceView{Prefs: json.RawMessage(pref.Prefs), UpdatedAt: pref.UpdatedAt}, nil
}

// PutPreference replaces the layout. The server only insists on a bounded JSON
// object; which keys mean what is the client's contract, and it discards keys
// it does not know.
func (s *HomeService) PutPreference(ctx context.Context, actor Actor, workspaceID string, prefs json.RawMessage) (HomePreferenceView, error) {
	ws, err := s.member(ctx, actor, workspaceID)
	if err != nil {
		return HomePreferenceView{}, err
	}
	if len(prefs) > maxHomePrefsBytes {
		return HomePreferenceView{}, Invalid("prefs must be at most 8 KiB")
	}
	if len(prefs) == 0 {
		prefs = json.RawMessage("{}")
	}
	if !isJSONObject(prefs) {
		return HomePreferenceView{}, Invalid("prefs must be a JSON object")
	}
	pref, err := s.q.UpsertHomePreference(ctx, db.UpsertHomePreferenceParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: ws.ID, UserID: actor.ID, Prefs: []byte(prefs),
	})
	if err != nil {
		return HomePreferenceView{}, err
	}
	return HomePreferenceView{Prefs: json.RawMessage(pref.Prefs), UpdatedAt: pref.UpdatedAt}, nil
}
