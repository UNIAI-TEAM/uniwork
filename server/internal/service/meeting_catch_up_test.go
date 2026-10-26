package service

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// catchUpSegment stores one transcript line of the given source ("AGENT" or
// "CAPTION") spoken `ago` before now.
func catchUpSegment(t *testing.T, s *AskUNIService, m db.Meeting, source, speaker, text string, ago time.Duration) db.MeetingTranscriptSegment {
	t.Helper()
	ctx := context.Background()
	at := pgtype.Timestamptz{Time: time.Now().Add(-ago).UTC().Truncate(time.Millisecond), Valid: true}
	if source == "AGENT" {
		seg, err := s.q.InsertAgentTranscriptSegment(ctx, db.InsertAgentTranscriptSegmentParams{
			ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, SpeakerName: speaker, Text: text,
			SpokenAt: at, ClientSegmentID: pgtype.Text{String: util.NewID(), Valid: true}, Language: "vi",
		})
		if err != nil {
			t.Fatal(err)
		}
		return seg
	}
	seg, err := s.q.InsertTranscriptSegment(ctx, db.InsertTranscriptSegmentParams{
		ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, SpeakerName: speaker, Text: text, SpokenAt: at,
	})
	if err != nil {
		t.Fatal(err)
	}
	return seg
}

func liveCatchUpMeeting(t *testing.T, s *AskUNIService, hostID, workspaceID string) db.Meeting {
	t.Helper()
	m, err := s.meetings.CreateInstant(context.Background(), hostID, workspaceID, "Giao ban")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(context.Background(), `UPDATE meetings SET actual_start_at = now() - interval '30 minutes' WHERE id = $1`, m.ID); err != nil {
		t.Fatal(err)
	}
	m, err = s.q.GetMeeting(context.Background(), m.ID)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

// D17: catch-up is for workspace members only; anyone else (a guest, an
// outsider with an account) is refused before anything is read or billed.
func TestMeetingCatchUpRefusesNonMembers(t *testing.T) {
	s, fake, ua, ub, w := askFixture(t)
	m := liveCatchUpMeeting(t, s, ua.ID, w.ID)
	catchUpSegment(t, s, m, "AGENT", "An", "Chốt demo thứ Sáu", 20*time.Minute)
	_, err := s.MeetingCatchUp(context.Background(), ub.ID, m.ID, "vi")
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider catch-up: %v, want ErrForbidden (403)", err)
	}
	if fake.Calls != 0 {
		t.Fatalf("gateway called %d times for a refused caller", fake.Calls)
	}
}

// UNI-1995 access: a workspace member the host never invited or admitted
// gets no brief either, and nothing is billed.
func TestMeetingCatchUpRefusesMembersOutsideTheMeeting(t *testing.T) {
	s, fake, ua, ub, w := askFixture(t)
	addMember(t, s.meetings, w.ID, ub.ID)
	m := liveCatchUpMeeting(t, s, ua.ID, w.ID)
	catchUpSegment(t, s, m, "AGENT", "An", "Chốt lương quý IV", 20*time.Minute)
	if _, err := s.MeetingCatchUp(context.Background(), ub.ID, m.ID, "vi"); !codedIs(err, "meeting_ai_restricted") {
		t.Fatalf("uninvited member catch-up: %v, want meeting_ai_restricted", err)
	}
	if fake.Calls != 0 {
		t.Fatalf("gateway called %d times for a refused caller", fake.Calls)
	}
}

func TestMeetingCatchUpNeedsALiveMeeting(t *testing.T) {
	s, _, ua, _, w := askFixture(t)
	start := time.Now().Add(time.Hour)
	m, err := s.meetings.Create(context.Background(), ua.ID, w.ID, CreateMeetingInput{Title: "Sau", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.MeetingCatchUp(context.Background(), ua.ID, m.ID, "vi")
	if !codedIs(err, "invalid_meeting_state") {
		t.Fatalf("scheduled meeting: %v, want invalid_meeting_state", err)
	}
}

// Nothing said and nothing noted: an honest empty brief, no model call.
func TestMeetingCatchUpWithoutSourcesSkipsTheModel(t *testing.T) {
	s, fake, ua, _, w := askFixture(t)
	m := liveCatchUpMeeting(t, s, ua.ID, w.ID)
	res, err := s.MeetingCatchUp(context.Background(), ua.ID, m.ID, "vi")
	if err != nil {
		t.Fatal(err)
	}
	if fake.Calls != 0 || res.Summary == "" || len(res.Highlights) != 0 {
		t.Fatalf("calls %d, result %+v", fake.Calls, res)
	}
}

// The brief reads the transcript by the parent spec's §7.3 rule (the
// scribe's lines win over Web Speech captions) plus the notes, every point
// points back at the stretch of speech it came from, and five late joiners
// at once cost one gateway call (B7, §5.1).
func TestMeetingCatchUpCoalescesAndPointsAtSegments(t *testing.T) {
	s, fake, ua, ub, w := askFixture(t)
	addMember(t, s.meetings, w.ID, ub.ID)
	m := liveCatchUpMeeting(t, s, ua.ID, w.ID)
	if _, err := s.meetings.Invite(context.Background(), ua.ID, m.ID, ub.ID); err != nil {
		t.Fatal(err)
	}
	first := catchUpSegment(t, s, m, "AGENT", "An", "Mở đầu: chốt lịch demo", 25*time.Minute)
	catchUpSegment(t, s, m, "CAPTION", "Bình", "phụ đề trình duyệt không được dùng", 24*time.Minute)
	if _, err := s.meetings.AddNote(context.Background(), ua.ID, m.ID, "Ghi chú: ngân sách quý IV"); err != nil {
		t.Fatal(err)
	}
	fake.Delay = 200 * time.Millisecond

	var wg sync.WaitGroup
	results := make([]MeetingCatchUpResult, 5)
	errs := make([]error, 5)
	for i := range 5 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			uid := ua.ID
			if i%2 == 1 {
				uid = ub.ID
			}
			results[i], errs[i] = s.MeetingCatchUp(context.Background(), uid, m.ID, "vi")
		}()
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("caller %d: %v", i, err)
		}
	}
	if fake.Calls != 1 {
		t.Fatalf("gateway calls = %d, want 1 for five callers", fake.Calls)
	}
	// A sixth caller inside the window is served from the cache too.
	again, err := s.MeetingCatchUp(context.Background(), ub.ID, m.ID, "vi")
	if err != nil || fake.Calls != 1 || again.Summary != results[0].Summary {
		t.Fatalf("cached read: calls %d, err %v", fake.Calls, err)
	}
	prompt := fake.Last.Messages[len(fake.Last.Messages)-1].Content
	if !strings.Contains(prompt, "chốt lịch demo") || !strings.Contains(prompt, "ngân sách quý IV") {
		t.Fatalf("prompt lacks the transcript or the notes:\n%s", prompt)
	}
	if strings.Contains(prompt, "phụ đề trình duyệt") {
		t.Fatalf("captions reached the prompt although the scribe transcribed the meeting:\n%s", prompt)
	}
	var pointed bool
	for _, h := range results[0].Highlights {
		if h.SegmentID == first.ID {
			pointed = h.SpokenAt != nil && h.SpokenAt.Equal(first.SpokenAt.Time)
		}
	}
	if !pointed {
		t.Fatalf("no highlight points at the first segment with its time: %+v", results[0].Highlights)
	}
}

// With Redis the brief is shared across nodes: a second node (its own
// process cache) reads the first one's answer instead of paying again.
func TestMeetingCatchUpSharedAcrossNodesThroughRedis(t *testing.T) {
	rdb := uniworkRedis(t)
	s, fake, ua, _, w := askFixture(t)
	s.catchUps = newBriefCache(rdb, meetingCatchUpTTL, s.gw.CallTimeout())
	m := liveCatchUpMeeting(t, s, ua.ID, w.ID)
	catchUpSegment(t, s, m, "AGENT", "An", "Chốt demo thứ Sáu", 20*time.Minute)
	if _, err := s.MeetingCatchUp(context.Background(), ua.ID, m.ID, "vi"); err != nil {
		t.Fatal(err)
	}
	// A second node: its own service over the same database and gateway, sharing the brief through Redis.
	other := NewAskUNIService(s.pool, s.q, s.ws, s.orgs, s.tasks, s.meetings, s.chat, s.gw, s.rdb)
	other.catchUps = newBriefCache(rdb, meetingCatchUpTTL, s.gw.CallTimeout())
	if _, err := other.MeetingCatchUp(context.Background(), ua.ID, m.ID, "vi"); err != nil {
		t.Fatal(err)
	}
	if fake.Calls != 1 {
		t.Fatalf("gateway calls = %d across two nodes, want 1", fake.Calls)
	}
}

// Fix round 1: a node that finds another one asking the model waits for its
// brief for as long as that call can take (the claim outlives the gateway's
// call timeout), instead of paying again.
func TestMeetingCatchUpSecondNodeAwaitsTheFirst(t *testing.T) {
	rdb := uniworkRedis(t)
	s, fake, ua, _, w := askFixture(t)
	s.catchUps = newBriefCache(rdb, meetingCatchUpTTL, s.gw.CallTimeout())
	if s.catchUps.claimTTL <= s.gw.CallTimeout() {
		t.Fatalf("claim TTL %v does not outlive the gateway call timeout %v", s.catchUps.claimTTL, s.gw.CallTimeout())
	}
	m := liveCatchUpMeeting(t, s, ua.ID, w.ID)
	catchUpSegment(t, s, m, "AGENT", "An", "Chốt demo thứ Sáu", 20*time.Minute)
	fake.Delay = 1500 * time.Millisecond
	// A second node: its own service over the same database and gateway, sharing the brief through Redis.
	other := NewAskUNIService(s.pool, s.q, s.ws, s.orgs, s.tasks, s.meetings, s.chat, s.gw, s.rdb)
	other.catchUps = newBriefCache(rdb, meetingCatchUpTTL, s.gw.CallTimeout())

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, node := range []*AskUNIService{s, other} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if i == 1 {
				time.Sleep(300 * time.Millisecond) // the first node holds the claim by now
			}
			_, errs[i] = node.MeetingCatchUp(context.Background(), ua.ID, m.ID, "vi")
		}()
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("node %d: %v", i, err)
		}
	}
	if fake.Calls != 1 {
		t.Fatalf("gateway calls = %d across two nodes at once, want 1", fake.Calls)
	}
}
