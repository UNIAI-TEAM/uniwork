package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestMeetingChat(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Chat")
	if err != nil {
		t.Fatal(err)
	}

	if _, err := s.AppendChatMessage(ctx, ua.ID, "", m.ID, "   "); err == nil {
		t.Fatal("empty chat accepted")
	}
	msg, err := s.AppendChatMessage(ctx, ua.ID, "", m.ID, "Xin chào\nmọi người")
	if err != nil || !strings.Contains(msg.Message, "\n") || msg.SenderName != "A" {
		t.Fatalf("%+v %v", msg, err)
	}
	if _, err := s.AppendChatMessage(ctx, ub.ID, "", m.ID, "x"); err == nil {
		t.Fatal("non-member sent chat")
	}
	msgs, err := s.ChatMessages(ctx, ua.ID, "", m.ID)
	if err != nil || len(msgs) != 1 {
		t.Fatalf("%d %v", len(msgs), err)
	}

	if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendChatMessage(ctx, ua.ID, "", m.ID, "late"); err == nil {
		t.Fatal("chat after end")
	}
	if hist, err := s.ChatMessages(ctx, ua.ID, "", m.ID); err != nil || len(hist) != 1 {
		t.Fatalf("history unreadable after end: %d %v", len(hist), err)
	}
}

func TestMeetingChatTruncation(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Chat")
	if err != nil {
		t.Fatal(err)
	}
	msg, err := s.AppendChatMessage(ctx, ua.ID, "", m.ID, strings.Repeat("a", 5000))
	if err != nil {
		t.Fatal(err)
	}
	if len(msg.Message) != 4000 {
		t.Fatalf("len = %d, want 4000", len(msg.Message))
	}
}

func TestMeetingChatRequiresJoin(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	addMember(t, s, w.ID, ub.ID)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Chat")
	if err != nil {
		t.Fatal(err)
	}
	var ve ValidationError
	if _, err := s.AppendChatMessage(ctx, ub.ID, "", m.ID, "hi"); !errors.As(err, &ve) || ve.Msg != "chưa tham gia phòng họp" {
		t.Fatalf("want join validation, got %v", err)
	}
}

func TestMeetingChatBeforeStart(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour).Truncate(time.Second)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{
		Title: "Later", StartsAt: start, EndsAt: start.Add(time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendChatMessage(ctx, ua.ID, "", m.ID, "early"); err == nil {
		t.Fatal("chat before start accepted")
	}
	if _, err := s.ChatMessages(ctx, ub.ID, "", m.ID); err != ErrForbidden {
		t.Fatalf("non-member list chat: %v", err)
	}
}

// seedChat inserts rows with fixed sent_at values so paging can be asserted
// without depending on the clock.
func seedChat(t *testing.T, s *MeetingService, m db.Meeting, rows ...struct {
	id string
	at time.Time
}) {
	t.Helper()
	for _, r := range rows {
		if _, err := s.q.InsertMeetingChatMessage(context.Background(), db.InsertMeetingChatMessageParams{
			ID: r.id, MeetingID: m.ID, OrganizationID: m.OrganizationID, SenderIdentity: "p_x", SenderName: "X",
			Message: r.id, SentAt: pgtype.Timestamptz{Time: r.at, Valid: true},
		}); err != nil {
			t.Fatal(err)
		}
	}
}

func chatIDs(rows []db.MeetingChatMessage) string {
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	return strings.Join(ids, ",")
}

// G18: the feed hands out the newest page first, in reading order, and walks
// back with a (sent_at, id) cursor - ties on sent_at split by id.
func TestMeetingChatFeedPagesNewestFirst(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Feed")
	if err != nil {
		t.Fatal(err)
	}
	base := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	type row = struct {
		id string
		at time.Time
	}
	seedChat(t, s, m,
		row{"c1", base}, row{"c2", base.Add(time.Second)},
		row{"c3a", base.Add(2 * time.Second)}, row{"c3b", base.Add(2 * time.Second)},
		row{"c5", base.Add(3 * time.Second)},
	)

	page, err := s.ChatFeed(ctx, ua.ID, "", m.ID, FeedQuery{Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if got := chatIDs(page.Items); got != "c3b,c5" || page.OlderCursor == "" || page.AfterCursor == "" || page.HasMoreAfter {
		t.Fatalf("newest page = %s %+v", got, page)
	}
	page, err = s.ChatFeed(ctx, ua.ID, "", m.ID, FeedQuery{Limit: 2, Before: page.OlderCursor})
	if err != nil {
		t.Fatal(err)
	}
	if got := chatIDs(page.Items); got != "c2,c3a" || page.OlderCursor == "" {
		t.Fatalf("second page = %s %+v", got, page)
	}
	page, err = s.ChatFeed(ctx, ua.ID, "", m.ID, FeedQuery{Limit: 2, Before: page.OlderCursor})
	if err != nil {
		t.Fatal(err)
	}
	if got := chatIDs(page.Items); got != "c1" || page.OlderCursor != "" {
		t.Fatalf("last page = %s %+v", got, page)
	}

	// The no-parameter call old clients make is the newest default page.
	all, err := s.ChatMessages(ctx, ua.ID, "", m.ID)
	if err != nil || chatIDs(all) != "c1,c2,c3a,c3b,c5" {
		t.Fatalf("default page = %s %v", chatIDs(all), err)
	}

	if _, err := s.ChatFeed(ctx, ub.ID, "", m.ID, FeedQuery{}); err != ErrForbidden {
		t.Fatalf("non-member read the feed: %v", err)
	}
}

// G7: a realtime frame makes the client ask only for what arrived since its
// cursor; a delta larger than one page says so, and the client refetches.
func TestMeetingChatFeedDelta(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Delta")
	if err != nil {
		t.Fatal(err)
	}
	type row = struct {
		id string
		at time.Time
	}
	old := time.Now().UTC().Add(-time.Hour)
	seedChat(t, s, m, row{"d1", old.Add(-10 * time.Second)}, row{"d2", old})
	page, err := s.ChatFeed(ctx, ua.ID, "", m.ID, FeedQuery{})
	if err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	seedChat(t, s, m, row{"d3", now}, row{"d4", now.Add(time.Millisecond)})
	delta, err := s.ChatFeed(ctx, ua.ID, "", m.ID, FeedQuery{After: page.AfterCursor})
	if err != nil {
		t.Fatal(err)
	}
	// d2 is inside the overlap window and comes back again; d1 does not.
	if got := chatIDs(delta.Items); got != "d2,d3,d4" || delta.HasMoreAfter || delta.OlderCursor != "" {
		t.Fatalf("delta = %s %+v", got, delta)
	}
	if delta.AfterCursor == page.AfterCursor {
		t.Fatal("after cursor did not advance")
	}
	same, err := s.ChatFeed(ctx, ua.ID, "", m.ID, FeedQuery{After: delta.AfterCursor})
	if err != nil || chatIDs(same.Items) != "d3,d4" || same.AfterCursor != delta.AfterCursor {
		t.Fatalf("quiet delta = %s %+v %v", chatIDs(same.Items), same, err)
	}

	short, err := s.ChatFeed(ctx, ua.ID, "", m.ID, FeedQuery{After: page.AfterCursor, Limit: 2})
	if err != nil || !short.HasMoreAfter || chatIDs(short.Items) != "d2,d3" {
		t.Fatalf("truncated delta = %s %+v %v", chatIDs(short.Items), short, err)
	}
}

func TestMeetingFeedQueryValidation(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Bad")
	if err != nil {
		t.Fatal(err)
	}
	cursor := encodeFeedCursor(time.Now(), "x")
	var ve ValidationError
	for _, q := range []FeedQuery{
		{Before: "nope"}, {After: "12.x.y"}, {After: ".id"}, {Before: cursor, After: cursor}, {Limit: -1},
		// Times Postgres cannot hold are the client's mistake (400), not a 500.
		{Before: "-9223372036854775808.x"}, {After: "9223372036854775807.x"},
	} {
		if _, err := s.ChatFeed(ctx, ua.ID, "", m.ID, q); !errors.As(err, &ve) {
			t.Fatalf("%+v accepted: %v", q, err)
		}
		if _, err := s.Transcript(ctx, ua.ID, m.ID, q); !errors.As(err, &ve) {
			t.Fatalf("transcript %+v accepted: %v", q, err)
		}
	}
	if got := (FeedQuery{Limit: 100000}).limit(); got != feedMaxLimit {
		t.Fatalf("limit clamp = %d", got)
	}
	if got := (FeedQuery{}).limit(); got != feedDefaultLimit {
		t.Fatalf("default limit = %d", got)
	}
}

func TestFeedCursorRoundTrip(t *testing.T) {
	at := time.Date(2026, 10, 5, 9, 30, 1, 123456000, time.UTC)
	gotAt, gotID, err := decodeFeedCursor(encodeFeedCursor(at, "01J8X4"))
	if err != nil || !gotAt.Equal(at) || gotID != "01J8X4" {
		t.Fatalf("%v %q %v", gotAt, gotID, err)
	}
}
