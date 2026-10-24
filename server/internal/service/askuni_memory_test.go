package service

import (
	"context"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// memWorld is the action world with the memory service wired and its flag on.
func memWorld(t *testing.T) (*actWorld, *AiMemoryService) {
	t.Helper()
	w := newActWorld(t, "")
	m := NewAiMemoryService(w.s.pool, w.s.q, w.s.orgs, w.s.ws)
	m.SetFlags(memoryFlagFake{on: true})
	w.s.SetMemory(m)
	return w, m
}

func TestTurnMemoryOnlyWhenAllowed(t *testing.T) {
	ctx := context.Background()
	w, m := memWorld(t)
	u, org := w.x.ua.ID, w.x.w.OrganizationID
	if _, err := m.Create(ctx, u, org, "fact", "Tôi làm ở phòng Kinh doanh"); err != nil {
		t.Fatal(err)
	}
	pref, err := m.Create(ctx, u, org, "preference", "Trả lời ngắn")
	if err != nil {
		t.Fatal(err)
	}
	turn := func(dock bool) *askMemoryTurn {
		got, err := w.s.turnMemory(ctx, w.tc, AskInput{Dock: dock})
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	if got := turn(false); got != nil {
		t.Fatalf("the old route got memory: %+v", got)
	}
	got := turn(true)
	if got == nil || len(got.entries) != 2 || got.refs["M1"] != pref.ID {
		t.Fatalf("turn memory = %+v, want M1 = the preference", got)
	}
	if pe := got.promptEntries(); pe[0] != (ai.MemoryEntry{Ref: "M1", Kind: "preference", Body: "Trả lời ngắn"}) || pe[1].Ref != "M2" {
		t.Fatalf("prompt entries = %+v", pe)
	}
	if len(w.m.memoryEntries) != 1 || w.m.memoryEntries[0] != 2 {
		t.Fatalf("entries metric = %v, want one observation of 2", w.m.memoryEntries)
	}
	if err := m.SetOn(ctx, u, false); err != nil {
		t.Fatal(err)
	}
	if got := turn(true); got != nil {
		t.Fatalf("the asker's switch is off but the turn has memory: %+v", got)
	}
	if err := m.SetOn(ctx, u, true); err != nil {
		t.Fatal(err)
	}
	m.SetFlags(memoryFlagFake{on: false})
	if got := turn(true); got != nil {
		t.Fatalf("the flag is off but the turn has memory: %+v", got)
	}
}

func TestTurnMemoryReadsOnlyTheAskersMemoryInThisOrganization(t *testing.T) {
	ctx := context.Background()
	w, m := memWorld(t)
	u, org := w.x.ua.ID, w.x.w.OrganizationID
	if _, err := m.Create(ctx, u, org, "fact", "mục của A"); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Create(ctx, w.x.ub.ID, org, "fact", "mục của người khác"); err != nil {
		t.Fatal(err)
	}
	// The asker's entry in an organization they left: no foreign key, so a raw row stands for it.
	if _, err := w.s.q.AiInsertMemory(ctx, db.AiInsertMemoryParams{
		ID: "01HOLDORGMEMORY0000000000", OrganizationID: "01HOLDORG00000000000000000", UserID: u,
		Kind: "fact", Body: "mục của tổ chức cũ", Source: aiMemorySourceManual, CreatedBy: u, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	got, err := w.s.turnMemory(ctx, w.tc, AskInput{Dock: true})
	if err != nil || got == nil || len(got.entries) != 1 || got.entries[0].Body != "mục của A" {
		t.Fatalf("turn memory = %+v, %v", got, err)
	}
	reqs := scriptCalls(w.fake, "Xong.")
	w.ask(t, ctx, AskInput{}, nil)
	msgs := (*reqs)[0].Messages
	sent := msgs[len(msgs)-1].Content
	if !strings.Contains(sent, "mục của A") || strings.Contains(sent, "mục của tổ chức cũ") || strings.Contains(sent, "mục của người khác") {
		t.Fatalf("the prompt carries the wrong memory:\n%s", sent)
	}
}

func TestAgentPicksMemoryPrompt(t *testing.T) {
	ctx := context.Background()
	for _, c := range []struct {
		name          string
		actions, mem  bool
		prompt        string
		wantMemoryRow bool
	}{
		{"memory and writes", true, true, ai.PromptCopilotAnswerV14, true},
		{"memory only", false, true, ai.PromptCopilotAnswerV12, true},
		{"switch off, writes", true, false, ai.PromptCopilotAnswerV6, false},
		{"switch off", false, false, ai.PromptCopilotAnswerV4, false},
	} {
		t.Run(c.name, func(t *testing.T) {
			w, m := memWorld(t)
			w.s.SetFlags(withActions{agentFlagFake{org: w.x.w.OrganizationID}, c.actions})
			if _, err := m.Create(ctx, w.x.ua.ID, w.x.w.OrganizationID, "preference", "Trả lời ngắn"); err != nil {
				t.Fatal(err)
			}
			if err := m.SetOn(ctx, w.x.ua.ID, c.mem); err != nil {
				t.Fatal(err)
			}
			reqs := scriptCalls(w.fake, "Xong.")
			res := w.ask(t, ctx, AskInput{}, nil)
			p, _ := ai.LookupPrompt(c.prompt)
			first := (*reqs)[0]
			if first.System != p.System {
				t.Fatalf("system is not %s", c.prompt)
			}
			last := first.Messages[len(first.Messages)-1].Content
			if has := strings.Contains(last, "M1 (preference) Trả lời ngắn"); has != c.wantMemoryRow {
				t.Fatalf("memory block present = %v:\n%s", has, last)
			}
			u, err := w.s.q.AiGetUsageEvent(ctx, res.Message.UsageEventID.String)
			if err != nil || u.PromptID != c.prompt {
				t.Fatalf("usage prompt %q %v, want %s", u.PromptID, err, c.prompt)
			}
		})
	}
}
