package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func codeOf(err error) string {
	var ce CodedError
	var ve ValidationError
	switch {
	case errors.As(err, &ce):
		return ce.Code
	case errors.As(err, &ve):
		return "invalid_input"
	}
	return ""
}

// Spec 2026-10-20-meeting-scribe-agent-design §4.3: only a clerk marks the
// shared microphone, and the server - never the participant - sets the
// LiveKit attribute, live and in every later join token.
func TestSetSharedMicIsTheClerksAndTheServerSetsTheAttribute(t *testing.T) {
	s, ua, ub, m, pid := governanceFixture(t)
	ctx := context.Background()
	fake := s.provider.(*meetings.FakeProvider)
	identity := meetings.IdentityForParticipant(pid)

	if _, err := s.SetSharedMic(ctx, ub.ID, m.ID, pid, true); codeOf(err) != "not_meeting_clerk" {
		t.Fatalf("a plain participant marked the shared mic: %v", err)
	}
	if n := len(fake.AttributeCalls()); n != 0 {
		t.Fatalf("refused call still set %d attributes", n)
	}
	p, err := s.SetSharedMic(ctx, ua.ID, m.ID, pid, true)
	if err != nil || !p.SharedMicAt.Valid || p.SharedMicBy.String != ua.ID {
		t.Fatalf("host on: %+v %v", p, err)
	}
	calls := fake.AttributeCalls()
	last := calls[len(calls)-1]
	if last.RoomName != meetings.RoomNameForMeeting(m.ID) || last.Identity != identity || last.Attributes[meetings.AttrSharedMic] != "1" {
		t.Fatalf("attribute write = %+v", last)
	}
	// A reconnect keeps it: the join token carries the attribute.
	if _, err := s.Join(ctx, AdmissionContext{MeetingID: m.ID, UserID: ub.ID}); err != nil {
		t.Fatal(err)
	}
	if fake.LastJoin.Attributes[meetings.AttrSharedMic] != "1" {
		t.Fatalf("join token attributes = %v", fake.LastJoin.Attributes)
	}
	// A secretary is a clerk too; switching off deletes the attribute.
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, pid, ParticipantDutiesInput{IsSecretary: ptr(true)}); err != nil {
		t.Fatal(err)
	}
	if p, err = s.SetSharedMic(ctx, ub.ID, m.ID, pid, false); err != nil || p.SharedMicAt.Valid {
		t.Fatalf("secretary off: %+v %v", p, err)
	}
	calls = fake.AttributeCalls()
	if v, ok := calls[len(calls)-1].Attributes[meetings.AttrSharedMic]; !ok || v != "" {
		t.Fatalf("switch-off attribute write = %+v", calls[len(calls)-1])
	}
	if _, err := s.Join(ctx, AdmissionContext{MeetingID: m.ID, UserID: ub.ID}); err != nil {
		t.Fatal(err)
	}
	if _, ok := fake.LastJoin.Attributes[meetings.AttrSharedMic]; ok {
		t.Fatalf("join token still carries the shared mic: %v", fake.LastJoin.Attributes)
	}
	var audited int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionMeetingSharedMicToggled, m.ID).Scan(&audited); err != nil || audited != 2 {
		t.Fatalf("audit rows %d %v", audited, err)
	}
	if _, err := s.SetSharedMic(ctx, ua.ID, m.ID, "nope", true); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown participant: %v", err)
	}
}

func ptr[T any](v T) *T { return &v }

// The agent learns who the shared mic is from /agent/context too (§4.2).
func TestAgentContextListsTheSharedMic(t *testing.T) {
	s, fake, ua, m := scribeFixture(t)
	ctx := context.Background()
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	c := claimsOf(t, s, fake)
	p, _ := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: m.ID, UserID: strText(ua.ID)})
	if _, err := s.SetSharedMic(ctx, ua.ID, m.ID, p.ID, true); err != nil {
		t.Fatal(err)
	}
	got, err := s.AgentContext(ctx, c)
	if err != nil || len(got.SharedMicIdentities) != 1 || got.SharedMicIdentities[0] != meetings.IdentityForParticipant(p.ID) {
		t.Fatalf("context = %+v %v", got, err)
	}
}

// Labels arrive with the agent's segments; a clerk assigns them; the
// transcript and the summary input name the speaker by the assignment, then
// "Hội trường · Người nói n" numbered per meeting by first appearance (two
// STT sessions that both say "A" are two speakers), and "Hội trường · Không
// rõ" for a line the vendor could not attribute.
func TestSpeakerLabelsAssignAndNameTheTranscript(t *testing.T) {
	s, fake, ua, m := scribeFixture(t)
	ctx := context.Background()
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	c := claimsOf(t, s, fake)
	if err := s.AgentStarted(ctx, c, "PA_agent1"); err != nil {
		t.Fatal(err)
	}
	p, _ := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: m.ID, UserID: strText(ua.ID)})
	identity := meetings.IdentityForParticipant(p.ID)
	at := m.ActualStartAt.Time.Add(5 * time.Second)
	labelA1 := identity + ":AJ1-TR1-1:A"
	a1 := agentSeg("TR1-1", identity, at, 2000)
	a1.SpeakerLabel = labelA1
	unknown := agentSeg("TR1-2", identity, at.Add(time.Second), 500)
	unknown.SpeakerLabel = identity + ":AJ1-TR1-1:?"
	plain := agentSeg("TR2-1", identity, at.Add(2*time.Second), 1000)
	a2 := agentSeg("TR1-3", identity, at.Add(time.Minute), 2000)
	a2.SpeakerLabel = identity + ":AJ1-TR1-2:A" // the next STT session's "A"
	bad := agentSeg("TR1-9", identity, at, 1000)
	bad.SpeakerLabel = "uw_participant_other:AJ1-TR1-1:B"
	if _, _, err := s.AppendAgentSegments(ctx, c, []AgentSegmentInput{bad}); codeOf(err) != "invalid_input" {
		t.Fatalf("a label of another participant: %v", err)
	}
	if n, _, err := s.AppendAgentSegments(ctx, c, []AgentSegmentInput{a1, unknown, plain}); err != nil || n != 3 {
		t.Fatalf("append: %d %v", n, err)
	}
	if n, _, err := s.AppendAgentSegments(ctx, c, []AgentSegmentInput{a2}); err != nil || n != 1 {
		t.Fatalf("append second session: %d %v", n, err)
	}

	labels, err := s.SpeakerLabels(ctx, ua.ID, m.ID)
	if err != nil || len(labels) != 2 {
		t.Fatalf("labels = %+v %v", labels, err)
	}
	l := labels[0]
	if l.LabelKey != labelA1 || l.Number != 1 || labels[1].Number != 2 || l.UserID.Valid || l.Name != "" || !strings.HasPrefix(l.Sample, "Chốt ship") {
		t.Fatalf("labels = %+v", labels)
	}
	names := func() (map[string]string, TranscriptPage) {
		t.Helper()
		page, err := s.Transcript(ctx, ua.ID, m.ID, FeedQuery{})
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]string{}
		for _, g := range page.Items {
			out[g.ClientSegmentID.String] = g.SpeakerName
		}
		return out, page
	}
	got, page := names()
	if got["TR1-1"] != "Hội trường · Người nói 1" || got["TR1-3"] != "Hội trường · Người nói 2" ||
		got["TR1-2"] != "Hội trường · Không rõ" || got["TR2-1"] != "A" {
		t.Fatalf("names before assignment = %v", got)
	}
	if page.Speakers[labelA1].Number != 1 {
		t.Fatalf("page speakers = %v", page.Speakers)
	}

	outsider := mustUserID(t, s, "b@example.com")
	if _, err := s.AssignSpeakerLabel(ctx, ua.ID, m.ID, l.ID, &outsider, nil); codeOf(err) != "assignee_not_member" {
		t.Fatalf("a non-member was assigned: %v", err)
	}
	if _, err := s.AssignSpeakerLabel(ctx, ua.ID, m.ID, l.ID, &ua.ID, ptr("Chị Lan")); codeOf(err) != "invalid_input" {
		t.Fatalf("both user and name: %v", err)
	}
	// A plain member of the workspace may read labels but not assign them.
	addMember(t, s, m.WorkspaceID, outsider)
	if _, err := s.SpeakerLabels(ctx, outsider, m.ID); err != nil {
		t.Fatalf("member reads labels: %v", err)
	}
	if _, err := s.AssignSpeakerLabel(ctx, outsider, m.ID, l.ID, nil, ptr("Chị Lan")); codeOf(err) != "not_meeting_clerk" {
		t.Fatalf("a non-clerk assigned: %v", err)
	}
	// A label of the meeting is not reachable through another real meeting.
	other, err := s.CreateInstant(ctx, ua.ID, m.WorkspaceID, "Họp khác")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AssignSpeakerLabel(ctx, ua.ID, other.ID, l.ID, nil, ptr("Chị Lan")); !errors.Is(err, ErrNotFound) {
		t.Fatalf("label assigned through another meeting: %v", err)
	}
	// A member: the display name, current, as the answer and in the transcript.
	v, err := s.AssignSpeakerLabel(ctx, ua.ID, m.ID, labels[1].ID, &ua.ID, nil)
	if err != nil || v.UserName != "A" || v.Number != 2 || v.UserID.String != ua.ID {
		t.Fatalf("member assignment = %+v %v", v, err)
	}
	if _, err := s.AssignSpeakerLabel(ctx, ua.ID, m.ID, l.ID, nil, ptr(" Chị Lan ")); err != nil {
		t.Fatal(err)
	}
	if got, _ := names(); got["TR1-1"] != "Chị Lan" || got["TR1-3"] != "A" || got["TR1-2"] != "Hội trường · Không rõ" {
		t.Fatalf("names after assignment = %v", got)
	}
	var audited int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = $1`, audit.ActionMeetingSpeakerLabelAssigned).Scan(&audited); err != nil || audited != 2 {
		t.Fatalf("audit rows %d %v", audited, err)
	}

	// The summary input names the speakers the same way, in its own language.
	if _, err := s.AssignSpeakerLabel(ctx, ua.ID, m.ID, labels[1].ID, nil, nil); err != nil {
		t.Fatal(err)
	}
	llm := &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: `{"summary":"Done.","decisions":[],"action_items":[]}`, Model: "fake"}
	}}
	s.AI = ai.NewGateway(s.q, llm, NewAIQuota(s.ent), nil, ai.Options{})
	if _, err := s.Summarize(ctx, ua.ID, m.ID, "en"); err != nil {
		t.Fatal(err)
	}
	prompt := llm.Last.Messages[len(llm.Last.Messages)-1].Content
	if !strings.Contains(prompt, "Chị Lan: Chốt ship") || !strings.Contains(prompt, "Room · Speaker 2: ") ||
		!strings.Contains(prompt, "Room · Unknown: ") || strings.Contains(prompt, "Người nói") {
		t.Fatalf("summary input does not name the speakers: %s", prompt)
	}
}

// An uploaded recording has no room mic: its unnamed speakers read "Người nói n",
// the shared mic's keep their "Hội trường ·" prefix.
func TestSpeakerNameWordsUploadedSpeakersPlainly(t *testing.T) {
	speakers := map[string]SpeakerName{"upload:T1:A": {Number: 1}, "p:s:A": {Number: 2}, "upload:T1:B": {Number: 3, Name: "Chị Lan"}}
	cases := []struct{ label, locale, want string }{
		{"upload:T1:A", "vi", "Người nói 1"},
		{"upload:T1:A", "en", "Speaker 1"},
		{"upload:T1:?", "vi", "Không rõ người nói"},
		{"upload:T1:B", "vi", "Chị Lan"},
		{"p:s:A", "vi", "Hội trường · Người nói 2"},
	}
	for _, c := range cases {
		if got := speakerName(db.MeetingTranscriptSegment{SpeakerLabel: c.label}, speakers, c.locale); got != c.want {
			t.Errorf("speakerName(%q, %s) = %q, want %q", c.label, c.locale, got, c.want)
		}
	}
}
