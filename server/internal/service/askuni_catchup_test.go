package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

func TestCatchUpExcerptKinds(t *testing.T) {
	cases := []struct {
		kind, body, want string
	}{
		{"text", "  xin chào  ", "xin chào"},
		{"text", "", ""},
		{"voice", "", "(tin nhắn thoại)"},
		{"file", "", "(tệp đính kèm)"},
		{"poll", "", "(bình chọn)"},
		{"post", "", "(bài đăng)"},
		{"unknown", "", ""},
		{"voice", "transcript", "transcript"},
	}
	for _, tc := range cases {
		got := catchUpExcerpt(ChatMessageRow{Kind: tc.kind, Body: tc.body})
		if got != tc.want {
			t.Fatalf("kind=%s body=%q: got %q want %q", tc.kind, tc.body, got, tc.want)
		}
	}
}

func TestCatchUpInboundAfterFiltersSelfAndOlder(t *testing.T) {
	since := time.Date(2026, 9, 11, 8, 0, 0, 0, time.UTC)
	rows := []ChatMessageRow{
		{ID: "1", SenderID: "self", CreatedAt: since.Add(time.Hour), Body: "mine"},
		{ID: "2", SenderID: "peer", CreatedAt: since.Add(-time.Minute), Body: "old"},
		{ID: "3", SenderID: "peer", CreatedAt: since.Add(time.Minute), Body: "new"},
	}
	out := catchUpInboundAfter(rows, "self", since)
	if len(out) != 1 || out[0].ID != "3" {
		t.Fatalf("got %+v", out)
	}
}

func TestCatchUpRejectsEmptyRoom(t *testing.T) {
	s, _, ua, _, w := askFixture(t)
	_, err := s.CatchUp(context.Background(), ua.ID, w.ID, CatchUpInput{RoomID: "  "})
	var inv ValidationError
	if !errors.As(err, &inv) {
		t.Fatalf("want ValidationError, got %T %v", err, err)
	}
}

func TestCatchUpEmptyAndUnreadRoom(t *testing.T) {
	s, fake, ua, ub, w := askFixture(t)
	ctx := context.Background()
	addMember(t, s.meetings, w.ID, ub.ID)

	room, err := s.chat.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil || room.RoomID == "" {
		t.Fatalf("ensure room: %+v %v", room, err)
	}

	empty, err := s.CatchUp(ctx, ua.ID, w.ID, CatchUpInput{RoomID: room.RoomID, Locale: "en"})
	if err != nil {
		t.Fatal(err)
	}
	if empty.MessageCount != 0 || empty.Mode != "unread" || empty.Summary != "Nothing new since you last read." {
		t.Fatalf("empty en: %+v", empty)
	}
	emptyVI, err := s.CatchUp(ctx, ua.ID, w.ID, CatchUpInput{RoomID: room.RoomID, Locale: "vi"})
	if err != nil {
		t.Fatal(err)
	}
	if emptyVI.Summary != "Không có tin mới kể từ lần đọc trước." {
		t.Fatalf("empty vi: %+v", emptyVI)
	}
	if fake.Calls != 0 {
		t.Fatalf("empty catch-up must not call the provider: %d", fake.Calls)
	}

	if _, err := s.chat.SendWorkspaceMessage(ctx, ub.ID, w.ID, SendChatMessageInput{Body: "Nhắc hạn F-09"}); err != nil {
		t.Fatal(err)
	}

	brief, err := s.CatchUp(ctx, ua.ID, w.ID, CatchUpInput{RoomID: room.RoomID, Locale: "vi"})
	if err != nil {
		t.Fatal(err)
	}
	if brief.MessageCount != 1 || brief.Mode != "unread" || brief.InputTokens == 0 {
		t.Fatalf("brief: %+v", brief)
	}
	if brief.Summary == "" {
		t.Fatalf("summary empty: %+v", brief)
	}
	if fake.Calls != 1 {
		t.Fatalf("provider calls: %d", fake.Calls)
	}
	prompt := fake.Last.Messages[len(fake.Last.Messages)-1].Content
	if !strings.Contains(prompt, "Nhắc hạn F-09") {
		t.Fatalf("prompt missing body:\n%s", prompt)
	}

	// Self-authored messages are never summarised for the same user.
	if _, err := s.chat.SendWorkspaceMessage(ctx, ua.ID, w.ID, SendChatMessageInput{Body: "chỉ mình tôi"}); err != nil {
		t.Fatal(err)
	}
	calls := fake.Calls
	again, err := s.CatchUp(ctx, ua.ID, w.ID, CatchUpInput{RoomID: room.RoomID})
	if err != nil {
		t.Fatal(err)
	}
	// Peer's unread still there (CatchUp does not advance last_read).
	if again.MessageCount != 1 || fake.Calls != calls+1 {
		t.Fatalf("after self-send: %+v calls=%d", again, fake.Calls)
	}
}

func TestCatchUpRequiresMembershipAndEnabledGateway(t *testing.T) {
	s, fake, ua, ub, w := askFixture(t)
	ctx := context.Background()
	room, err := s.chat.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := s.CatchUp(ctx, ub.ID, w.ID, CatchUpInput{RoomID: room.RoomID}); !errors.Is(err, ai.ErrContextForbidden) {
		t.Fatalf("non-member: %v", err)
	}

	off := NewAskUNIService(s.pool, s.q, s.ws, s.orgs, s.tasks, s.meetings, s.chat,
		ai.NewGateway(s.q, nil, NewAIQuota(s.ent), nil, ai.Options{}), nil)
	if _, err := off.CatchUp(ctx, ua.ID, w.ID, CatchUpInput{RoomID: room.RoomID}); !errors.Is(err, ai.ErrDisabled) {
		t.Fatalf("disabled gateway: %v", err)
	}
	_ = fake
}
