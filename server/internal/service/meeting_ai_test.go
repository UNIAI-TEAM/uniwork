package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestTranscriptAndSummaryToTasks(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	s.Tasks = NewTaskService(s.pool, s.q, s.ws, nil)
	fake := &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{
			Text:  `{"summary":"Đã chốt.","decisions":["Ship thứ Sáu"],"action_items":[{"title":"Gửi báo cáo","owner":"B"}]}`,
			Model: "fake", InputTokens: 30, OutputTokens: 20,
		}
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

	s.rt.STTAgentSecret = "agent-secret"
	identity := meetings.IdentityForParticipant(seg.ParticipantID.String)
	agentSeg, err := s.AppendTranscriptFromAgent(ctx, m.ID, identity, "", "Agent line", time.Time{})
	if err != nil || agentSeg.Text != "Agent line" {
		t.Fatalf("agent transcript: %+v %v", agentSeg, err)
	}
	segs, err = s.Transcript(ctx, ua.ID, m.ID)
	if err != nil || len(segs) != 2 {
		t.Fatalf("want 2 segments, got %d %v", len(segs), err)
	}

	// AI off → 503-coded error; on → row stored with JSON columns.
	var ce CodedError
	if _, err := s.Summarize(ctx, ua.ID, m.ID, "vi"); !errors.As(err, &ce) || ce.Code != "ai_not_configured" {
		t.Fatalf("expected ai_not_configured, got %v", err)
	}
	s.AI = ai.NewGateway(s.q, fake, NewAIQuota(s.ent), nil, ai.Options{})
	sum, err := s.Summarize(ctx, ua.ID, m.ID, "vi")
	if err != nil {
		t.Fatal(err)
	}
	prompt := fake.Last.Messages[len(fake.Last.Messages)-1].Content
	if fake.Calls != 1 || !strings.Contains(prompt, "Meeting title: AI") || !strings.Contains(prompt, "A: Chốt ship vào thứ Sáu") || !strings.Contains(prompt, "Output language: Vietnamese") {
		t.Fatalf("gateway prompt: %s", prompt)
	}
	if sum.Summary != "Đã chốt." || !strings.Contains(sum.ActionItems, "Gửi báo cáo") || sum.Model != "fake" || !sum.UsageEventID.Valid {
		t.Fatalf("%+v", sum)
	}
	if ev, err := s.q.AiGetUsageEvent(ctx, sum.UsageEventID.String); err != nil || ev.Status != "succeeded" || ev.Capability != "meeting_summarization" || ev.InputTokens != 30 {
		t.Fatalf("usage row: %+v %v", ev, err)
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

	tasks, err := s.CreateTasksFromSummary(ctx, ua.ID, m.ID, []SummaryTaskItem{
		{Title: "Gửi báo cáo", Owner: "B"},
		{Title: "Book phòng", AssigneeID: &ub.ID},
	})
	if err != nil || len(tasks) != 2 {
		t.Fatalf("%d %v", len(tasks), err)
	}
	if !strings.Contains(tasks[0].Description, "Từ cuộc họp: AI") || tasks[0].AssigneeID.String != ub.ID {
		t.Fatalf("owner resolve: %+v", tasks[0])
	}
	if tasks[0].OriginType.String != "meeting" || tasks[0].OriginID.String != m.ID {
		t.Fatalf("origin: type=%s id=%s", tasks[0].OriginType.String, tasks[0].OriginID.String)
	}
	if tasks[1].AssigneeID.String != ub.ID {
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
	if !strings.Contains(fake.Last.Messages[len(fake.Last.Messages)-1].Content, "Output language: English") {
		t.Fatalf("locale not forwarded")
	}
}

func TestSummarizeWithChatOnly(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	s.Tasks = NewTaskService(s.pool, s.q, s.ws, nil)
	fake := &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: `{"summary":"Chat only.","decisions":[],"action_items":[]}`, Model: "fake"}
	}}
	s.AI = ai.NewGateway(s.q, fake, NewAIQuota(s.ent), nil, ai.Options{})
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Chat")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendChatMessage(ctx, ua.ID, "", m.ID, "Chốt deadline thứ Sáu"); err != nil {
		t.Fatal(err)
	}
	sum, err := s.Summarize(ctx, ua.ID, m.ID, "vi")
	if err != nil {
		t.Fatal(err)
	}
	prompt := fake.Last.Messages[len(fake.Last.Messages)-1].Content
	if sum.Summary != "Chat only." || !strings.Contains(prompt, "Chốt deadline thứ Sáu") || !strings.Contains(prompt, `source="chat"`) {
		t.Fatalf("prompt=%s sum=%+v", prompt, sum)
	}
}

// TestSummaryFactsFromAttendanceAndMotions: the prompt facts carry members
// only and the stored count, with the required yes votes the UI shows.
func TestSummaryFactsFromAttendanceAndMotions(t *testing.T) {
	met := true
	m := db.Meeting{
		QuorumPercent:         pgtype.Int2{Int16: 50, Valid: true},
		AttendanceFinalizedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}
	row := func(name, standing, status string) AttendanceRow {
		return AttendanceRow{Participant: db.MeetingParticipant{DisplayNameSnapshot: name, Standing: standing}, Status: status}
	}
	rep := AttendanceReport{
		Rows: []AttendanceRow{
			row("An", StandingMember, AttendancePresent),
			row("Khách dự thính", StandingObserver, AttendancePresent),
			row("Bình", StandingMember, AttendanceExcused),
		},
		Summary: AttendanceSummary{Members: 2, Present: 1, Excused: 1, QuorumMet: &met},
	}
	f := summaryAttendanceFacts(m, rep)
	if f == nil || f.Members != 2 || f.Present != 1 || f.Excused != 1 || f.QuorumPercent != 50 ||
		f.QuorumMet == nil || !*f.QuorumMet || !f.Finalized {
		t.Fatalf("facts = %+v", f)
	}
	names := f.NamesByStatus
	if len(names[AttendancePresent]) != 1 || names[AttendancePresent][0] != "An" ||
		len(names[AttendanceExcused]) != 1 || names[AttendanceExcused][0] != "Bình" {
		t.Fatalf("names = %v (observers must not be listed)", names)
	}
	if summaryAttendanceFacts(m, AttendanceReport{}) != nil {
		t.Fatal("a meeting without members must give nil attendance facts")
	}

	closed := db.MeetingMotion{
		Title: "Đổi giờ giao ban", BallotMode: BallotPublic, Threshold: ThresholdTwoThirds, Base: BaseAllMembers, Status: MotionClosed,
		TotalMembers: pgtype.Int4{Int32: 4, Valid: true}, RollSize: pgtype.Int4{Int32: 3, Valid: true},
		YesCount: 3, Outcome: pgtype.Text{String: OutcomePassed, Valid: true},
	}
	got := summaryMotionFacts([]db.MeetingMotion{closed})
	// Two-thirds of all 4 members = ceil(8/3) = 3 yes votes.
	want := ai.MotionFact{Title: "Đổi giờ giao ban", BallotMode: BallotPublic, Yes: 3, Required: 3, Outcome: OutcomePassed}
	if len(got) != 1 || got[0] != want {
		t.Fatalf("motion facts = %+v, want %+v", got, want)
	}
}

// TestSummarizeWithClosedMotionOnly: a closed vote is enough material on its
// own, and the prompt carries its counted result and the attendance, never
// who chose what.
func TestSummarizeWithClosedMotionOnly(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	fake := &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: `{"summary":"Đã biểu quyết.","decisions":["Thông qua kế hoạch quý IV"],"action_items":[]}`, Model: "fake"}
	}}
	s.AI = ai.NewGateway(s.q, fake, NewAIQuota(s.ent), nil, ai.Options{})

	// Distinctive names: either one inside the vote block would be a leak.
	const hostName, voterName = "Lê Văn Chủ", "Trần Thị Bích"
	host := hostParticipant(t, s, m.ID, ua.ID)
	for pid, name := range map[string]string{host.ID: hostName, memberPID: voterName} {
		if _, err := s.pool.Exec(ctx, `UPDATE meeting_participants SET display_name_snapshot = $1 WHERE id = $2`, name, pid); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.pool.Exec(ctx, `UPDATE meetings SET quorum_percent = 60 WHERE id = $1`, m.ID); err != nil {
		t.Fatal(err)
	}
	// Host on time, member 15 minutes late: both on the roll.
	seedSession(t, s, m.ID, host.ID, "0 minutes", "")
	seedSession(t, s, m.ID, memberPID, "15 minutes", "")

	if _, err := s.CreateMotion(ctx, ua.ID, m.ID, MotionInput{Title: "Nháp chưa mở", BallotMode: BallotPublic, Threshold: ThresholdMajority, Base: BasePresent}); err != nil {
		t.Fatal(err)
	}
	mo, err := s.CreateMotion(ctx, ua.ID, m.ID, MotionInput{Title: "Thông qua kế hoạch quý IV", BallotMode: BallotSecret, Threshold: ThresholdMajority, Base: BasePresent})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.OpenMotion(ctx, ua.ID, m.ID, mo.ID); err != nil {
		t.Fatal(err)
	}
	// No transcript, notes or chat, and a vote still open is not material yet.
	if _, err := s.Summarize(ctx, ua.ID, m.ID, "vi"); !codedIs(err, "nothing_to_summarize") {
		t.Fatalf("open vote only: %v", err)
	}
	for _, uid := range []string{ua.ID, ub.ID} {
		if err := s.CastBallot(ctx, uid, "", m.ID, mo.ID, ChoiceYes); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.CloseMotion(ctx, ua.ID, m.ID, mo.ID); err != nil {
		t.Fatal(err)
	}

	sum, err := s.Summarize(ctx, ua.ID, m.ID, "vi")
	if err != nil {
		t.Fatal(err)
	}
	if fake.Calls != 1 || sum.Summary != "Đã biểu quyết." {
		t.Fatalf("calls=%d summary=%+v", fake.Calls, sum)
	}
	if ev, err := s.q.AiGetUsageEvent(ctx, sum.UsageEventID.String); err != nil || ev.PromptID != "meeting_summary@2" {
		t.Fatalf("usage row: %+v %v", ev, err)
	}
	prompt := fake.Last.Messages[len(fake.Last.Messages)-1].Content
	for _, want := range []string{
		"Recorded attendance (system record — use exactly):\n",
		"- Members: 2 (present 1, late 1, excused 0, absent 0)\n",
		"- Minimum attendance: 60%, met\n",
		"- Attendance finalized: no (provisional)\n",
		`- Present: <untrusted source="attendance">` + hostName + "</untrusted>\n",
		`- Late: <untrusted source="attendance">` + voterName + "</untrusted>\n",
		"Recorded votes (system record — use exactly):\n",
		"- Vote 1: PASSED · secret ballot · yes 2 · no 0 · abstain 0 · 2 yes votes required\n",
		`  Title: <untrusted source="motions">Thông qua kế hoạch quý IV</untrusted>` + "\n",
		"(no transcript captured)",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}
	if strings.Contains(prompt, "Nháp chưa mở") {
		t.Fatalf("draft motion reached the prompt:\n%s", prompt)
	}
	start, end := strings.Index(prompt, "Recorded votes"), strings.Index(prompt, "\nTranscript:")
	if start < 0 || end < start {
		t.Fatalf("vote block not found:\n%s", prompt)
	}
	for _, name := range []string{hostName, voterName} {
		if strings.Contains(prompt[start:end], name) {
			t.Fatalf("vote block names %q:\n%s", name, prompt[start:end])
		}
	}
	if !strings.Contains(fake.Last.System, "Never state or guess how any person voted") {
		t.Fatalf("system prompt is not @2:\n%s", fake.Last.System)
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
	recs, _ := s.Recordings(ctx, ua.ID, "", m.ID)
	if len(recs) != 1 || recs[0].Status != RecordingProcessing {
		t.Fatalf("%+v", recs)
	}
	if err := s.HandleProviderEvent(ctx, ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-1", RecordingID: rec.EgressID,
		RecordingURL: "https://bucket/rec.mp4",
	}); err != nil {
		t.Fatal(err)
	}
	recs, _ = s.Recordings(ctx, ua.ID, "", m.ID)
	if recs[0].Status != RecordingComplete || recs[0].FileUrl.String != "https://bucket/rec.mp4" {
		t.Fatalf("%+v", recs[0])
	}
	if _, err := s.StopRecording(ctx, ua.ID, m.ID); !errors.As(err, &ce) || ce.Code != "recording_not_active" {
		t.Fatalf("stop without active: %v", err)
	}
}

func TestMeetingRecordingForPlayback(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	fp := s.provider.(*meetings.FakeProvider)
	fp.RecordingEnabled = true
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Playback")
	if err != nil {
		t.Fatal(err)
	}
	rec, err := s.StartRecording(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	var ce CodedError
	if _, err := s.GetMeetingRecordingForPlayback(ctx, ua.ID, "", m.ID, rec.ID); !errors.As(err, &ce) || ce.Code != "recording_not_ready" {
		t.Fatalf("active recording: %v", err)
	}
	if _, err := s.StopRecording(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.HandleProviderEvent(ctx, ProviderNeutralEvent{
		Type: "conference.recording_ended", ProviderEventID: "ev-playback", RecordingID: rec.EgressID,
		RecordingURL: "https://bucket/meeting-rec.mp4",
	}); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetMeetingRecordingForPlayback(ctx, ua.ID, "", m.ID, rec.ID)
	if err != nil || got.FileUrl.String != "https://bucket/meeting-rec.mp4" {
		t.Fatalf("playback: %+v err=%v", got, err)
	}
	if _, err := s.GetMeetingRecordingForPlayback(ctx, ua.ID, "", m.ID, ""); err == nil {
		t.Fatal("empty recording_id accepted")
	}
	if _, err := s.GetMeetingRecordingForPlayback(ctx, ua.ID, "", m.ID, "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing recording: %v", err)
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

	// Idle room past ends_at: empty, end immediately.
	idleStart := time.Now().Add(-2 * time.Hour)
	idleEnd := time.Now().Add(-30 * time.Minute)
	idle, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Idle OT", StartsAt: idleStart, EndsAt: idleEnd})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.StartMeeting(ctx, db.StartMeetingParams{UpdatedBy: strText(ua.ID), ID: idle.ID, Version: idle.Version}); err != nil {
		t.Fatal(err)
	}
	idleSess, err := s.q.CreateConferenceSession(ctx, db.CreateConferenceSessionParams{
		ID: util.NewID(), MeetingID: idle.ID, ProviderKey: s.rt.ProviderKey,
		ProviderRoomName: meetings.RoomNameForMeeting(idle.ID),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.UpdateConferenceSessionStatus(ctx, db.UpdateConferenceSessionStatusParams{
		ID: idleSess.ID, Status: strText("IDLE"),
	}); err != nil {
		t.Fatal(err)
	}
	n, err = s.AutoEndOverdue(ctx, time.Now())
	if err != nil || n != 1 {
		t.Fatalf("idle past end: %d %v", n, err)
	}
	gotIdle, _ := s.Get(ctx, ua.ID, idle.ID)
	if gotIdle.Status != MeetingEnded {
		t.Fatalf("idle status %s", gotIdle.Status)
	}

	// ACTIVE room past ends_at but within overtime: keep.
	liveStart := time.Now().Add(-2 * time.Hour)
	liveEnd := time.Now().Add(-30 * time.Minute)
	live, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Live OT", StartsAt: liveStart, EndsAt: liveEnd})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.StartMeeting(ctx, db.StartMeetingParams{UpdatedBy: strText(ua.ID), ID: live.ID, Version: live.Version}); err != nil {
		t.Fatal(err)
	}
	liveSess, err := s.q.CreateConferenceSession(ctx, db.CreateConferenceSessionParams{
		ID: util.NewID(), MeetingID: live.ID, ProviderKey: s.rt.ProviderKey,
		ProviderRoomName: meetings.RoomNameForMeeting(live.ID),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.UpdateConferenceSessionStatus(ctx, db.UpdateConferenceSessionStatusParams{
		ID: liveSess.ID, Status: strText("ACTIVE"),
	}); err != nil {
		t.Fatal(err)
	}
	n, err = s.AutoEndOverdue(ctx, time.Now())
	if err != nil || n != 0 {
		t.Fatalf("live within overtime: %d %v", n, err)
	}
	gotLive, _ := s.Get(ctx, ua.ID, live.ID)
	if gotLive.Status != MeetingInProgress {
		t.Fatalf("live status %s", gotLive.Status)
	}

	// ACTIVE room past ends_at + 2h: hard cap.
	capStart := time.Now().Add(-5 * time.Hour)
	capEnd := time.Now().Add(-3 * time.Hour)
	capped, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Capped", StartsAt: capStart, EndsAt: capEnd})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.StartMeeting(ctx, db.StartMeetingParams{UpdatedBy: strText(ua.ID), ID: capped.ID, Version: capped.Version}); err != nil {
		t.Fatal(err)
	}
	capSess, err := s.q.CreateConferenceSession(ctx, db.CreateConferenceSessionParams{
		ID: util.NewID(), MeetingID: capped.ID, ProviderKey: s.rt.ProviderKey,
		ProviderRoomName: meetings.RoomNameForMeeting(capped.ID),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.UpdateConferenceSessionStatus(ctx, db.UpdateConferenceSessionStatusParams{
		ID: capSess.ID, Status: strText("ACTIVE"),
	}); err != nil {
		t.Fatal(err)
	}
	n, err = s.AutoEndOverdue(ctx, time.Now())
	if err != nil || n != 1 {
		t.Fatalf("live past overtime: %d %v", n, err)
	}
	gotCap, _ := s.Get(ctx, ua.ID, capped.ID)
	if gotCap.Status != MeetingEnded {
		t.Fatalf("capped status %s", gotCap.Status)
	}
}

// The scheduler ended the meeting, not the last host and not a person called
// "system": audit_events and the outbox say system/meeting-auto-end, while
// the meeting timeline keeps its historical "system" actor id
// (TestAutoEndOverdue). A host's End stays a human act.
func TestAutoEndOverdueAuditsSystemActor(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	past := time.Now().Add(-5 * time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Old", StartsAt: past, EndsAt: past.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.StartMeeting(ctx, db.StartMeetingParams{UpdatedBy: strText(ua.ID), ID: m.ID, Version: m.Version}); err != nil {
		t.Fatal(err)
	}
	byHost, err := s.CreateInstant(ctx, ua.ID, w.ID, "Host ends")
	if err != nil {
		t.Fatal(err)
	}
	if n, err := s.AutoEndOverdue(ctx, time.Now()); err != nil || n != 1 {
		t.Fatalf("auto-end: %d %v", n, err)
	}
	if _, err := s.End(ctx, ua.ID, byHost.ID); err != nil {
		t.Fatal(err)
	}

	var kind, actorID string
	if err := s.pool.QueryRow(ctx,
		`SELECT actor_kind, actor_id FROM audit_events WHERE action = 'meeting.ended' AND resource_id = $1`, m.ID,
	).Scan(&kind, &actorID); err != nil {
		t.Fatal(err)
	}
	if kind != string(audit.KindSystem) || actorID != "meeting-auto-end" {
		t.Fatalf("auto-end audit actor = %s/%s, want system/meeting-auto-end", kind, actorID)
	}
	var outboxKind string
	if err := s.pool.QueryRow(ctx,
		`SELECT actor_kind FROM outbox_events WHERE topic = 'meeting.ended' AND payload::jsonb->>'meeting_id' = $1`, m.ID,
	).Scan(&outboxKind); err != nil {
		t.Fatal(err)
	}
	if outboxKind != string(audit.KindSystem) {
		t.Fatalf("auto-end outbox actor_kind = %q, want system", outboxKind)
	}
	var timelineActor string
	if err := s.pool.QueryRow(ctx,
		`SELECT actor_id FROM meeting_audit_logs WHERE event_type = 'MEETING_AUTO_ENDED' AND meeting_id = $1`, m.ID,
	).Scan(&timelineActor); err != nil {
		t.Fatal(err)
	}
	if timelineActor != "system" {
		t.Fatalf("timeline actor_id = %q, want system", timelineActor)
	}

	if err := s.pool.QueryRow(ctx,
		`SELECT actor_kind, actor_id FROM audit_events WHERE action = 'meeting.ended' AND resource_id = $1`, byHost.ID,
	).Scan(&kind, &actorID); err != nil {
		t.Fatal(err)
	}
	if kind != string(audit.KindHuman) || actorID != ua.ID {
		t.Fatalf("host end audit actor = %s/%s, want human/%s", kind, actorID, ua.ID)
	}
}
func TestExtendEndsAtWhileInProgress(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(-10 * time.Minute).Truncate(time.Second)
	end := time.Now().Add(20 * time.Minute).Truncate(time.Second)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{
		Title: "Live", StartsAt: start, EndsAt: end,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Start(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	later := time.Now().Add(45 * time.Minute).Truncate(time.Second)
	if _, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{EndsAt: &later}); err == nil {
		t.Fatal("patch ends_at while in progress")
	}
	before := time.Now()
	up, err := s.Extend(ctx, ua.ID, m.ID, 15)
	if err != nil {
		t.Fatal(err)
	}
	if !up.EndsAt.Time.After(before.Add(14 * time.Minute)) {
		t.Fatalf("ends_at %v", up.EndsAt.Time)
	}
	past := time.Now().Add(-time.Minute)
	if _, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{EndsAt: &past}); err == nil {
		t.Fatal("past ends_at accepted")
	}
	nudge := time.Now().Add(time.Minute)
	if _, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{StartsAt: &nudge}); err == nil {
		t.Fatal("starts_at change accepted while in progress")
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
