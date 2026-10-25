package service

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
)

func TestSplitMemoryUsed(t *testing.T) {
	for _, c := range []struct {
		name, in, body string
		refs           []string
	}{
		{"after", "Trả lời.\n<memory_used>M1, M3</memory_used>", "Trả lời.", []string{"M1", "M3"}},
		{"before followups", "A.\n<memory_used>M2</memory_used>\n<followups>\n- Gì?\n</followups>", "A.\n\n<followups>\n- Gì?\n</followups>", []string{"M2"}},
		{"after followups", "A.\n<followups>\n- Gì?\n</followups>\n<memory_used>M2</memory_used>", "A.\n<followups>\n- Gì?\n</followups>", []string{"M2"}},
		{"two blocks merge, dedup", "A.<memory_used>M1 M2</memory_used> B.<memory_used>M2,M1,M4</memory_used>", "A. B.", []string{"M1", "M2", "M4"}},
		{"malformed refs dropped", "A.<memory_used>M01, X1, M0, m1, M7</memory_used>", "A.", []string{"M7"}},
		{"cut off tag", "A.\n<memory_used>M1", "A.", nil},
		{"none", "Chỉ trả lời.", "Chỉ trả lời.", nil},
	} {
		t.Run(c.name, func(t *testing.T) {
			body, refs := splitMemoryUsed(c.in)
			if body != c.body || !slices.Equal(refs, c.refs) {
				t.Fatalf("got %q %v, want %q %v", body, refs, c.body, c.refs)
			}
		})
	}
}

func TestMemoryUsedIDsDropsUnknownRefs(t *testing.T) {
	m := &askMemoryTurn{refs: map[string]string{"M1": "id1", "M2": "id2"}}
	if got := m.usedIDs([]string{"M2", "M9", "M1"}); !slices.Equal(got, []string{"id2", "id1"}) {
		t.Fatalf("got %v", got)
	}
}

func TestCutAtTagsHoldsBackMemoryTagOnlyWhenAsked(t *testing.T) {
	if got := cutAtTags("xong.\n<memo", followupsTag, memoryUsedTag); got != "xong.\n" {
		t.Fatalf("held tail: %q", got)
	}
	if got := cutAtTags("a<memory_used>M1", followupsTag, memoryUsedTag); got != "a" {
		t.Fatalf("cut: %q", got)
	}
	if got := cutAtFollowups("a<memory_used>M1"); got != "a<memory_used>M1" {
		t.Fatalf("followups only: %q", got)
	}
}

func TestMemoryUsedNeverStreams(t *testing.T) {
	ctx := context.Background()
	w, m := memWorld(t)
	if _, err := m.Create(ctx, w.x.ua.ID, w.x.w.OrganizationID, "preference", "Trả lời ngắn"); err != nil {
		t.Fatal(err)
	}
	w.fake.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
		if titleCall(req) {
			return provider.CompletionResponse{Text: "Tiêu đề", UsagePresent: true, StopReason: "end_turn"}
		}
		return provider.CompletionResponse{StopReason: "end_turn", UsagePresent: true, InputTokens: 20, OutputTokens: 7,
			Text: "Đã trả lời xong.\n<memory_used>M1</memory_used>\n<followups>\n- Tiếp?\n</followups>"}
	}
	w.fake.StreamChunk = 7
	var events []AskEvent
	w.ask(t, ctx, AskInput{}, &events)
	sent := joinDeltas(events)
	if strings.Contains(sent, "<memo") || strings.Contains(sent, "M1") || !strings.HasPrefix(sent, "Đã trả lời xong.") {
		t.Fatalf("streamed %q", sent)
	}
}

func TestAgentStoresMemoryUsed(t *testing.T) {
	ctx := context.Background()
	w, m := memWorld(t)
	u, org := w.x.ua.ID, w.x.w.OrganizationID
	e, err := m.Create(ctx, u, org, "preference", "Trả lời ngắn")
	if err != nil {
		t.Fatal(err)
	}
	scriptCalls(w.fake, "Xong.\n<memory_used>M1, M9</memory_used>")
	w.fake.StreamChunk = 5
	var events []AskEvent
	res := w.ask(t, ctx, AskInput{}, &events)
	if res.Message.Content != "Xong." || res.Message.MemoryIds != `["`+e.ID+`"]` {
		t.Fatalf("stored %q ids %s", res.Message.Content, res.Message.MemoryIds)
	}
	names := eventNames(events)
	if d := slices.Index(names, "done"); d < 1 || names[d-1] != "memory_used" || !slices.Equal(events[d-1].MemoryIDs, []string{e.ID}) {
		t.Fatalf("events %v", names)
	}
	if !slices.Equal(w.m.memory, []string{"used"}) {
		t.Fatalf("metric %v", w.m.memory)
	}
}

// Without memory the block is not the server's: the answer is left as written.
func TestMemoryUsedBlockStaysOnATurnWithoutMemory(t *testing.T) {
	ctx := context.Background()
	w, m := memWorld(t)
	if err := m.SetOn(ctx, w.x.ua.ID, false); err != nil {
		t.Fatal(err)
	}
	answer := "Xong.\n<memory_used>M1</memory_used>"
	scriptCalls(w.fake, answer)
	var events []AskEvent
	res := w.ask(t, ctx, AskInput{}, &events)
	if res.Message.Content != answer || res.Message.MemoryIds != "[]" || slices.Contains(eventNames(events), "memory_used") {
		t.Fatalf("stored %q ids %s events %v", res.Message.Content, res.Message.MemoryIds, eventNames(events))
	}
	if !strings.Contains(joinDeltas(events), "<memory_used>M1</memory_used>") {
		t.Fatalf("streamed %q", joinDeltas(events))
	}
}
