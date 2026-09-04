package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestTranscriptAndSummaryToTasks(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	s.Tasks = NewTaskService(s.q, s.ws, NopPublisher{})
	fake := &ai.Fake{Result: ai.MeetingSummary{
		Summary: "Đã chốt.", Decisions: []string{"Ship thứ Sáu"},
		ActionItems: []ai.ActionItem{{Title: "Gửi báo cáo", Owner: "B"}},
	}}
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "AI")
	if err != nil {
		t.Fatal(err)
	}

	// Transcript needs an IN_PROGRESS meeting and a non-empty line.
	if _, err := s.AppendTranscript(ctx, ua.ID, m.ID, "   ", time.Time{}); err == nil {
		t.Fatal("empty transcript accepted")
	}
	seg, err := s.AppendTranscript(ctx, ua.ID, m.ID, "Chốt ship vào thứ Sáu", time.Time{})
	if err != nil || seg.SpeakerName != "A" || !seg.ParticipantID.Valid {
		t.Fatalf("%+v %v", seg, err)
	}
	if _, err := s.AppendTranscript(ctx, ub.ID, m.ID, "x", time.Time{}); err == nil {
		t.Fatal("non-member appended transcript")
	}
	segs, err := s.Transcript(ctx, ua.ID, m.ID)
	if err != nil || len(segs) != 1 {
		t.Fatalf("%d %v", len(segs), err)
	}

	// AI off → 503-coded error; on → row stored with JSON columns.
	var ce CodedError
	if _, err := s.Summarize(ctx, ua.ID, m.ID, "vi"); !errors.As(err, &ce) || ce.Code != "ai_not_configured" {
		t.Fatalf("expected ai_not_configured, got %v", err)
	}
	s.AI = fake
	sum, err := s.Summarize(ctx, ua.ID, m.ID, "vi")
	if err != nil {
		t.Fatal(err)
	}
	if fake.Calls != 1 || fake.Last.Title != "AI" || len(fake.Last.Transcript) != 1 {
		t.Fatalf("summarizer input: %+v", fake.Last)
	}
	if sum.Summary != "Đã chốt." || !strings.Contains(sum.ActionItems, "Gửi báo cáo") || sum.Model != "fake" {
		t.Fatalf("%+v", sum)
	}
	latest, err := s.Summary(ctx, ua.ID, m.ID)
	if err != nil || latest == nil || latest.ID != sum.ID {
		t.Fatalf("%+v %v", latest, err)
	}
	// Non-host member cannot summarize; can read.
	addMember(t, s, w.ID, ub.ID)
	if _, err := s.Summarize(ctx, ub.ID, m.ID, "vi"); err == nil {
		t.Fatal("member summarized")
	}
	got, err := s.Summary(ctx, ub.ID, m.ID)
	if err != nil || got == nil || got.ID != sum.ID {
		t.Fatalf("%+v %v", got, err)
	}

	// No summary row yet → nil, not an error.
	m2, err := s.CreateInstant(ctx, ua.ID, w.ID, "Empty")
	if err != nil {
		t.Fatal(err)
	}
	empty, err := s.Summary(ctx, ua.ID, m2.ID)
	if err != nil || empty != nil {
		t.Fatalf("expected nil summary, got %+v %v", empty, err)
	}

	tasks, err := s.CreateTasksFromSummary(ctx, ua.ID, m.ID, []SummaryTaskItem{{Title: "Gửi báo cáo"}, {Title: "Book phòng", AssigneeID: &ub.ID}})
	if err != nil || len(tasks) != 2 {
		t.Fatalf("%d %v", len(tasks), err)
	}
	if !strings.Contains(tasks[0].Description, "Từ cuộc họp: AI") || tasks[1].AssigneeID.String != ub.ID {
		t.Fatalf("%+v", tasks)
	}
	if _, err := s.CreateTasksFromSummary(ctx, ua.ID, m.ID, nil); err == nil {
		t.Fatal("empty items accepted")
	}

	// Summary still allowed after the meeting ends; transcript is not.
	if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendTranscript(ctx, ua.ID, m.ID, "late", time.Time{}); err == nil {
		t.Fatal("transcript after end")
	}
	if _, err := s.Summarize(ctx, ua.ID, m.ID, "en"); err != nil {
		t.Fatal(err)
	}
	if fake.Last.Locale != "en" {
		t.Fatalf("locale not forwarded: %q", fake.Last.Locale)
	}
}

func TestRecordingLifecycle(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	fp := s.provider.(*meetings.FakeProvider)
	m, _ := s.CreateInstant(ctx, ua.ID, w.ID, "Rec")

	var ce CodedError
	if _, err := s.StartRecording(ctx, ua.ID, m.ID); !errors.As(err, &ce) || ce.Code != "recording_not_configured" {
		t.Fatalf("expected recording_not_configured, got %v", err)
	}
	fp.RecordingEnabled = true
	rec, err := s.StartRecording(ctx, ua.ID, m.ID)
	if err != nil || rec.Status != RecordingActive || fp.RecordCalls != 1 {
		t.Fatalf("%+v %v", rec, err)
	}
	if _, err := s.StartRecording(ctx, ua.ID, m.ID); !errors.As(err, &ce) || ce.Code != "recording_active" {
		t.Fatalf("double start: %v", err)
	}
	// Ending the meeting stops the recording; the webhook then finishes it.
	if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if fp.StopRecordCalls != 1 {
		t.Fatalf("stop calls %d", fp.StopRecordCalls)
	}
	recs, _ := s.Recordings(ctx, ua.ID, m.ID)
	if len(recs) != 1 || recs[0].Status != RecordingProcessing {
		t.Fatalf("%+v", recs)
	}
	if err := s.HandleProviderEvent(ctx, ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-1", RecordingID: rec.EgressID,
		RecordingURL: "https://bucket/rec.mp4",
	}); err != nil {
		t.Fatal(err)
	}
	recs, _ = s.Recordings(ctx, ua.ID, m.ID)
	if recs[0].Status != RecordingComplete || recs[0].FileUrl.String != "https://bucket/rec.mp4" {
		t.Fatalf("%+v", recs[0])
	}
	if _, err := s.StopRecording(ctx, ua.ID, m.ID); !errors.As(err, &ce) || ce.Code != "recording_not_active" {
		t.Fatalf("stop without active: %v", err)
	}
}

func TestAutoEndOverdue(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	past := time.Now().Add(-5 * time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Old", StartsAt: past, EndsAt: past.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.q.StartMeeting(ctx, db.StartMeetingParams{UpdatedBy: strText(ua.ID), ID: m.ID, Version: m.Version})
	if err != nil {
		t.Fatal(err)
	}
	fresh, _ := s.CreateInstant(ctx, ua.ID, w.ID, "Fresh")

	n, err := s.AutoEndOverdue(ctx, time.Now())
	if err != nil || n != 1 {
		t.Fatalf("%d %v", n, err)
	}
	got, _ := s.Get(ctx, ua.ID, m.ID)
	if got.Status != MeetingEnded {
		t.Fatalf("status %s", got.Status)
	}
	f, _ := s.Get(ctx, ua.ID, fresh.ID)
	if f.Status != MeetingInProgress {
		t.Fatalf("fresh meeting ended: %s", f.Status)
	}
	acts, _ := s.Activity(ctx, ua.ID, m.ID, 50, 0)
	found := false
	for _, a := range acts {
		if a.EventType == "MEETING_AUTO_ENDED" && a.ActorID == "system" {
			found = true
		}
	}
	if !found {
		t.Fatal("no MEETING_AUTO_ENDED audit row")
	}
}

func TestRenderICS(t *testing.T) {
	start := time.Date(2026, 8, 29, 2, 0, 0, 0, time.UTC)
	m := db.Meeting{
		ID: "01M", Title: "Standup; tuần, A\\B", Description: "Line1\nLine2", Version: 3, Status: MeetingScheduled,
		StartsAt: pgtype.Timestamptz{Time: start, Valid: true}, EndsAt: pgtype.Timestamptz{Time: start.Add(30 * time.Minute), Valid: true},
	}
	out := string(renderICS(m, "http://localhost:3000/o/w/meetings/01M", start))
	for _, want := range []string{
		"BEGIN:VCALENDAR\r\n", "UID:01M@uniwork\r\n", "DTSTART:20260829T020000Z\r\n", "DTEND:20260829T023000Z\r\n",
		`SUMMARY:Standup\; tuần\, A\\B` + "\r\n", `DESCRIPTION:Line1\nLine2\n\nhttp://localhost:3000/o/w/meetings/01M` + "\r\n",
		"URL:http://localhost:3000/o/w/meetings/01M\r\n", "STATUS:CONFIRMED\r\n", "SEQUENCE:3\r\n", "END:VCALENDAR\r\n",
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q in:\n%s", want, out)
		}
	}
	m.Status = MeetingCanceled
	if !strings.Contains(string(renderICS(m, "", start)), "STATUS:CANCELLED") {
		t.Fatal("canceled status")
	}
}

func TestCalendarICSJoinURL(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	now := time.Now().Add(time.Hour)
	m, _ := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Cal", StartsAt: now, EndsAt: now.Add(time.Hour)})
	out, err := s.CalendarICS(ctx, ua.ID, m.ID, "http://localhost:3000/")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), "URL:http://localhost:3000/org-alpha/alpha/meetings/"+m.ID) {
		t.Fatalf("join url missing:\n%s", out)
	}
}
