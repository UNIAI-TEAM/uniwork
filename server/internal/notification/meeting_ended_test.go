package notification

import (
	"context"
	"testing"
	"time"
)

// fakeSummaries stands in for MeetingService: the test DB's default plan
// does not include meeting.ai_summary, so the gate is injected.
type fakeSummaries struct{ on bool }

func (s fakeSummaries) SummaryAvailable(context.Context, string) bool { return s.on }

// endedMeeting starts an instant meeting as the owner, optionally says one
// transcript line, and ends it; the host is the actor of meeting.ended.
func (f *fixture) endedMeeting(t *testing.T, title string, withTranscript bool) string {
	t.Helper()
	m, err := f.meetings.CreateInstant(f.ctx, f.owner.ID, f.wsID, title)
	if err != nil {
		t.Fatal(err)
	}
	if withTranscript {
		if _, err := f.meetings.AppendTranscript(f.ctx, f.owner.ID, m.ID, "Chốt hạn thứ sáu", time.Time{}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.meetings.End(f.ctx, f.owner.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	return m.ID
}

func TestRuleMeetingEndedNudgesHost(t *testing.T) {
	f := newFixture(t)
	f.consumer.SetMeetingSummaries(fakeSummaries{on: true})
	meetingID := f.endedMeeting(t, "Giao ban", true)

	f.handleLast(t, "meeting.ended")
	got := f.inbox(t, f.owner.ID)
	if len(got) != 1 || got[0].Kind != KindMeetingSummaryReminder || got[0].ResourceType != "meeting" || got[0].ResourceID != meetingID {
		t.Fatalf("host inbox = %+v", got)
	}
	if got[0].ActorKind != "system" || !contains(got[0].Params, `"meeting":"Giao ban"`) || got[0].WorkspaceID.String != f.wsID {
		t.Fatalf("attribution = %+v", got[0])
	}
	if len(f.inbox(t, f.member.ID)) != 0 {
		t.Fatal("only the host is nudged")
	}
	// The same row again (a retry) leaves one notification.
	f.handleLast(t, "meeting.ended")
	if n := len(f.inbox(t, f.owner.ID)); n != 1 {
		t.Fatalf("after retry inbox = %d", n)
	}
}

func TestRuleMeetingEndedStaysQuiet(t *testing.T) {
	t.Run("nothing to summarize", func(t *testing.T) {
		f := newFixture(t)
		f.consumer.SetMeetingSummaries(fakeSummaries{on: true})
		f.endedMeeting(t, "Họp trống", false)
		f.handleLast(t, "meeting.ended")
		if got := f.inbox(t, f.owner.ID); len(got) != 0 {
			t.Fatalf("inbox = %+v", got)
		}
	})
	t.Run("summaries unavailable", func(t *testing.T) {
		f := newFixture(t)
		f.consumer.SetMeetingSummaries(fakeSummaries{on: false})
		f.endedMeeting(t, "Không có AI", true)
		f.handleLast(t, "meeting.ended")
		if got := f.inbox(t, f.owner.ID); len(got) != 0 {
			t.Fatalf("inbox = %+v", got)
		}
	})
	t.Run("port not wired", func(t *testing.T) {
		f := newFixture(t)
		f.endedMeeting(t, "Chưa nối port", true)
		f.handleLast(t, "meeting.ended")
		if got := f.inbox(t, f.owner.ID); len(got) != 0 {
			t.Fatalf("inbox = %+v", got)
		}
	})
	t.Run("already summarized", func(t *testing.T) {
		f := newFixture(t)
		f.consumer.SetMeetingSummaries(fakeSummaries{on: true})
		meetingID := f.endedMeeting(t, "Đã tóm tắt", true)
		if _, err := f.pool.Exec(f.ctx, `INSERT INTO meeting_summaries (id, organization_id, meeting_id, summary, created_by)
			VALUES ('sum-1', $1, $2, 'Tóm tắt', $3)`, f.orgID, meetingID, f.owner.ID); err != nil {
			t.Fatal(err)
		}
		f.handleLast(t, "meeting.ended")
		if got := f.inbox(t, f.owner.ID); len(got) != 0 {
			t.Fatalf("inbox = %+v", got)
		}
	})
}

func TestResourceURLOpensTheSummaryPanel(t *testing.T) {
	f := newFixture(t)
	f.consumer.SetMeetingSummaries(fakeSummaries{on: true})
	meetingID := f.endedMeeting(t, "Giao ban", true)
	f.handleLast(t, "meeting.ended")
	n := f.inbox(t, f.owner.ID)[0]
	got, err := ResourceURL(f.ctx, f.q, "https://app.test", n)
	if err != nil {
		t.Fatal(err)
	}
	if want := "https://app.test/notif-org/notif-ws/meetings/" + meetingID + "?section=summary"; got != want {
		t.Fatalf("url = %q, want %q", got, want)
	}
}
