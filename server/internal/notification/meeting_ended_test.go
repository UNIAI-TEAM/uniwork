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

// emit writes one outbox row the way the meeting worker would, attributed to
// the system job.
func (f *fixture) emit(t *testing.T, topic, payload string) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO outbox_events (id, workspace_id, organization_id, topic, payload, actor_kind, actor_id)
		VALUES ($1, $2, $3, $4, $5, 'system', 'meeting_auto_summary')`, "ev-"+topic+"-"+time.Now().Format("150405.000000000"), f.wsID, f.orgID, topic, payload); err != nil {
		t.Fatal(err)
	}
}

// meetingWithSecretary is an ended meeting with a transcript line, hosted by
// the owner, with the member appointed secretary.
func (f *fixture) meetingWithSecretary(t *testing.T, title string) string {
	t.Helper()
	m, err := f.meetings.CreateInstant(f.ctx, f.owner.ID, f.wsID, title)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.meetings.Invite(f.ctx, f.owner.ID, m.ID, f.member.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `UPDATE meeting_participants SET is_secretary = true WHERE meeting_id = $1 AND user_id = $2`, m.ID, f.member.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.meetings.AppendTranscript(f.ctx, f.owner.ID, m.ID, "Chốt hạn thứ sáu", time.Time{}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.meetings.End(f.ctx, f.owner.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	return m.ID
}

func (f *fixture) storeSummary(t *testing.T, id, meetingID, by, kind string) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO meeting_summaries (id, organization_id, meeting_id, summary, created_by, created_by_kind)
		VALUES ($1, $2, $3, 'Tóm tắt', $4, $5)`, id, f.orgID, meetingID, by, kind); err != nil {
		t.Fatal(err)
	}
	f.emit(t, "summary.created", `{"meeting_id":"`+meetingID+`","summary_id":"`+id+`","workspace_id":"`+f.wsID+`"}`)
}

// UNI-2026 (§4.5, §9): a summary the system made reaches the host and the
// secretary as meeting_summary_ready, landing on the summary panel.
func TestRuleSummaryCreatedTellsHostAndSecretaryWhenAuto(t *testing.T) {
	f := newFixture(t)
	meetingID := f.meetingWithSecretary(t, "Giao ban")
	f.storeSummary(t, "sum-auto", meetingID, "meeting_auto_summary", "system")
	f.handleLast(t, "summary.created")
	for _, uid := range []string{f.owner.ID, f.member.ID} {
		got := f.inbox(t, uid)
		if len(got) != 1 || got[0].Kind != KindMeetingSummaryReady || got[0].ResourceID != meetingID ||
			got[0].ActorKind != "system" || !contains(got[0].Params, `"meeting":"Giao ban"`) {
			t.Fatalf("inbox of %s = %+v", uid, got)
		}
		url, err := ResourceURL(f.ctx, f.q, "https://app.test", got[0])
		if err != nil || url != "https://app.test/notif-org/notif-ws/meetings/"+meetingID+"?section=summary" {
			t.Fatalf("url = %q %v", url, err)
		}
	}
}

func TestRuleSummaryCreatedStaysQuietForAPersonsSummary(t *testing.T) {
	f := newFixture(t)
	meetingID := f.meetingWithSecretary(t, "Giao ban")
	f.storeSummary(t, "sum-manual", meetingID, f.owner.ID, "human")
	f.handleLast(t, "summary.created")
	if got := append(f.inbox(t, f.owner.ID), f.inbox(t, f.member.ID)...); len(got) != 0 {
		t.Fatalf("inbox = %+v", got)
	}
}

// While the system is still to summarize, the end of the meeting nudges
// nobody; the reminder comes back when the auto run made no summary.
func TestRuleMeetingEndedWaitsForTheAutoSummary(t *testing.T) {
	f := newFixture(t)
	f.consumer.SetMeetingSummaries(fakeSummaries{on: true})
	meetingID := f.endedMeeting(t, "Giao ban", true)
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO meeting_auto_summaries (meeting_id, organization_id, due_at) VALUES ($1, $2, now())`, meetingID, f.orgID); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "meeting.ended")
	if got := f.inbox(t, f.owner.ID); len(got) != 0 {
		t.Fatalf("nudged while queued: %+v", got)
	}
	if _, err := f.pool.Exec(f.ctx, `DELETE FROM meeting_auto_summaries WHERE meeting_id = $1`, meetingID); err != nil {
		t.Fatal(err)
	}
	f.emit(t, "meeting.auto_summary_failed", `{"meeting_id":"`+meetingID+`","workspace_id":"`+f.wsID+`"}`)
	f.handleLast(t, "meeting.auto_summary_failed")
	got := f.inbox(t, f.owner.ID)
	if len(got) != 1 || got[0].Kind != KindMeetingSummaryReminder {
		t.Fatalf("after the failed auto run: %+v", got)
	}
	// meeting.ended handled late, after the failure: still one reminder.
	f.readAll(t, f.owner.ID)
	f.handleLast(t, "meeting.ended")
	if n := len(f.inbox(t, f.owner.ID)); n != 1 {
		t.Fatalf("reminders = %d, want 1", n)
	}
}
