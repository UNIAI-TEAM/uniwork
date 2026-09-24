package service

import (
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestChatSidebarPreviewBody(t *testing.T) {
	t.Parallel()
	body := "[@tran hoang long](mention://member/USER1) check in"
	got := chatSidebarPreviewBody(body, "text")
	want := "@tran hoang long check in"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	if chatSidebarPreviewBody("hello", "voice_call_log") != "" {
		t.Fatal("voice call log preview should be empty")
	}

	long := strings.Repeat("x", 130)
	for _, tc := range []struct {
		kind   string
		prefix string
	}{
		{kind: "poll", prefix: "📊 "},
		{kind: "reminder", prefix: "⏰ "},
		{kind: "note", prefix: "📝 "},
	} {
		out := chatSidebarPreviewBody(long, tc.kind)
		if !strings.HasPrefix(out, tc.prefix) || !strings.HasSuffix(out, "…") {
			t.Fatalf("%s preview %q", tc.kind, out)
		}
		if chatSidebarPreviewBody("  short  ", tc.kind) != tc.prefix+"short" {
			t.Fatalf("%s short", tc.kind)
		}
	}
	if !strings.HasSuffix(chatSidebarPreviewBody(long, "text"), "…") {
		t.Fatal("text truncation")
	}
}

func TestApplyLastMessagePreview(t *testing.T) {
	t.Parallel()
	applyLastMessagePreview(nil, &chatLastMessagePreview{})
	applyLastMessagePreview(&ChatRoomSummary{}, nil)
	applyLastMessagePreview(&ChatRoomSummary{}, &chatLastMessagePreview{})

	now := time.Date(2026, 9, 22, 10, 0, 0, 0, time.UTC)
	summary := &ChatRoomSummary{}
	applyLastMessagePreview(summary, &chatLastMessagePreview{
		Body: "hi", Kind: "text", SenderID: "u1", SenderDisplayName: "An", CreatedAt: now,
	})
	if summary.LastMessageBody != "hi" || summary.LastMessageKind != "text" || summary.LastMessageSenderID != "u1" || summary.LastMessageSenderName != "An" || summary.LastMessageAt == nil {
		t.Fatalf("%+v", summary)
	}

	if lastMessagePreviewFromListRow("b", "text", "u", "n", pgtype.Timestamptz{}) != nil {
		t.Fatal("invalid timestamptz")
	}
	p := lastMessagePreviewFromListRow("b", "note", "u", "n", pgtype.Timestamptz{Time: now, Valid: true})
	if p == nil || p.Kind != "note" || !p.CreatedAt.Equal(now) {
		t.Fatalf("%+v", p)
	}
}
