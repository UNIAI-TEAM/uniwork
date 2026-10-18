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
	got := ChatPreviewBody(body, "text")
	want := "@tran hoang long check in"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	if ChatPreviewBody("hello", "voice_call_log") != "" {
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
		out := ChatPreviewBody(long, tc.kind)
		if !strings.HasPrefix(out, tc.prefix) || !strings.HasSuffix(out, "…") {
			t.Fatalf("%s preview %q", tc.kind, out)
		}
		if ChatPreviewBody("  short  ", tc.kind) != tc.prefix+"short" {
			t.Fatalf("%s short", tc.kind)
		}
	}
	if !strings.HasSuffix(ChatPreviewBody(long, "text"), "…") {
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

	if lastMessagePreviewFromListRow("b", "text", "u", "n", "", 0, pgtype.Timestamptz{}) != nil {
		t.Fatal("invalid timestamptz")
	}
	p := lastMessagePreviewFromListRow("b", "note", "u", "n", "", 0, pgtype.Timestamptz{Time: now, Valid: true})
	if p == nil || p.Kind != "note" || !p.CreatedAt.Equal(now) {
		t.Fatalf("%+v", p)
	}

	// A call log's outcome and a voice note's length ride to the summary for the list line.
	call := &ChatRoomSummary{}
	applyLastMessagePreview(call, lastMessagePreviewFromListRow("", "voice_call_log", "u", "n", "unanswered", 0, pgtype.Timestamptz{Time: now, Valid: true}))
	if call.LastMessageCallOutcome != "unanswered" || call.LastMessageBody != "" {
		t.Fatalf("call %+v", call)
	}
	voice := &ChatRoomSummary{}
	applyLastMessagePreview(voice, lastMessagePreviewFromListRow("", "voice", "u", "n", "", 42000, pgtype.Timestamptz{Time: now, Valid: true}))
	if voice.LastMessageDurationMS != 42000 {
		t.Fatalf("voice %+v", voice)
	}
}
