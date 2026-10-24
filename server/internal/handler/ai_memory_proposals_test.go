package handler

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// memProposal stores a memory proposal of the owner's under an answer of its
// own, as a turn would have, expiring after ttl; it returns the row's id.
func (w *memWorld) memProposal(t *testing.T, action, memoryID, body string, ttl time.Duration) string {
	t.Helper()
	text := func(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }
	kind := ""
	if body != "" {
		kind = "fact"
	}
	row, err := w.q.AiInsertMemoryProposal(context.Background(), db.AiInsertMemoryProposalParams{
		ID: util.NewID(), OrganizationID: w.orgID, WorkspaceID: w.wsID, ConversationID: util.NewID(), MessageID: util.NewID(),
		Position: 1, Action: action, MemoryID: text(memoryID), Kind: text(kind), Body: text(body),
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(ttl), Valid: true}, CreatedBy: w.ownerID, CreatedByKind: "human",
	})
	if err != nil {
		t.Fatal(err)
	}
	return row.ID
}

// conflict is the owner's call answering 409 code with the row, as it now
// stands, in error.fields.proposal.
func (w *memWorld) conflict(t *testing.T, method, path string, body any, code, status string) {
	t.Helper()
	s, out := w.call(t, w.owner, method, path, body)
	if s != 409 || errCode(out) != code || proposalOf(out, "proposal")["status"] != status {
		t.Fatalf("%s %s: %d %v, want 409 %s with the row %s", method, path, s, out, code, status)
	}
}

func TestMemoryProposalRoutesMapErrors(t *testing.T) {
	w := newMemWorld(t)
	base := "/api/v1/ai/memory-proposals/"
	coffee := w.memProposal(t, "remember", "", "Tôi thích cà phê", time.Hour)
	if s, out := w.call(t, w.owner, "POST", base+coffee+"/apply", nil); s != 403 || errCode(out) != "ai_memory_disabled" {
		t.Fatalf("flag off: %d %v", s, out)
	}
	w.flag(t, "ask_uni_memory", featureflags.ScopeGlobal, "", true)

	// Someone else's row and an id that names nothing answer alike, with no row.
	for _, id := range []string{coffee, util.NewID()} {
		for _, c := range []struct{ method, path string }{
			{"POST", base + id + "/apply"}, {"POST", base + id + "/reject"}, {"POST", base + id + "/undo"}, {"PATCH", base + id},
		} {
			s, out := w.call(t, w.member, c.method, c.path, map[string]any{"text": "x"})
			if s != 404 || errCode(out) != "not_found" || strings.Contains(fmt.Sprint(out), "cà phê") || out["error"].(map[string]any)["fields"] != nil {
				t.Fatalf("member %s %s: %d %v", c.method, c.path, s, out)
			}
		}
	}

	if s, out := w.call(t, w.owner, "PATCH", base+coffee, map[string]any{"text": strings.Repeat("a", 301)}); s != 400 {
		t.Fatalf("301 runes: %d %v", s, out)
	}
	if s, out := w.call(t, w.owner, "PATCH", base+coffee, map[string]any{"kind": "preference"}); s != 200 || out["kind"] != "preference" || out["status"] != "pending" || out["text"] != "Tôi thích cà phê" {
		t.Fatalf("edit: %d %v", s, out)
	}
	if s, _ := w.call(t, w.owner, "PUT", "/api/v1/me/ask-uni-memory", map[string]any{"enabled": false}); s != 204 {
		t.Fatalf("switch off: %d", s)
	}
	w.conflict(t, "POST", base+coffee+"/apply", nil, "ai_memory_off", "pending")
	if s, _ := w.call(t, w.owner, "PUT", "/api/v1/me/ask-uni-memory", map[string]any{"enabled": true}); s != 204 {
		t.Fatalf("switch on: %d", s)
	}
	s, out := w.call(t, w.owner, "POST", base+coffee+"/apply", nil)
	memID, _ := out["memory_id"].(string)
	if s != 200 || out["status"] != "applied" || memID == "" {
		t.Fatalf("apply: %d %v", s, out)
	}
	w.conflict(t, "POST", base+coffee+"/apply", nil, "proposal_not_pending", "applied")
	w.conflict(t, "PATCH", base+coffee, map[string]any{"text": "khác"}, "proposal_not_pending", "applied")
	// The entry edited since the apply: no undo.
	if s, out := w.call(t, w.owner, "PATCH", "/api/v1/orgs/aimem/ai/memory/"+memID, map[string]any{"text": "Tôi thích trà"}); s != 200 {
		t.Fatalf("edit entry: %d %v", s, out)
	}
	w.conflict(t, "POST", base+coffee+"/undo", nil, "undo_unavailable", "applied")

	hue := w.memProposal(t, "remember", "", "Tôi ở Huế", time.Hour)
	if s, out := w.call(t, w.owner, "POST", base+hue+"/reject", nil); s != 200 || out["status"] != "rejected" {
		t.Fatalf("reject: %d %v", s, out)
	}
	w.conflict(t, "POST", base+hue+"/reject", nil, "proposal_not_pending", "rejected")
	w.conflict(t, "POST", base+hue+"/undo", nil, "proposal_not_pending", "rejected")

	bus := w.memProposal(t, "remember", "", "Tôi đi xe buýt", time.Hour)
	if s, out := w.call(t, w.owner, "POST", base+bus+"/apply", nil); s != 200 {
		t.Fatalf("apply bus: %d %v", s, out)
	}
	if s, out := w.call(t, w.owner, "POST", base+bus+"/undo", nil); s != 200 || out["status"] != "undone" {
		t.Fatalf("undo: %d %v", s, out)
	}

	early := w.memProposal(t, "remember", "", "Tôi dậy sớm", -time.Minute)
	w.conflict(t, "POST", base+early+"/apply", nil, "proposal_expired", "expired")
	w.conflict(t, "PATCH", base+early, map[string]any{"text": "Tôi dậy muộn"}, "proposal_expired", "expired")
	if s, out := w.call(t, w.owner, "POST", base+early+"/reject", nil); s != 200 || out["status"] != "rejected" {
		t.Fatalf("reject expired: %d %v", s, out)
	}
	w.conflict(t, "POST", base+w.memProposal(t, "remember", "", "tôi thích  trà", time.Hour)+"/apply", nil, "ai_memory_duplicate", "pending")
	if s, out := w.call(t, w.owner, "POST", base+w.memProposal(t, "forget", util.NewID(), "", time.Hour)+"/apply", nil); s != 404 || errCode(out) != "ai_memory_not_found" {
		t.Fatalf("entry gone: %d %v", s, out)
	}
	// Fill the memory to 50 (the tea entry is one).
	for i := 0; i < 49; i++ {
		if s, out := w.call(t, w.owner, "POST", "/api/v1/orgs/aimem/ai/memory", map[string]any{"kind": "fact", "text": fmt.Sprintf("mục số %d", i)}); s != 201 {
			t.Fatalf("fill %d: %d %v", i, s, out)
		}
	}
	w.conflict(t, "POST", base+w.memProposal(t, "remember", "", "Mục thứ năm mươi mốt", time.Hour)+"/apply", nil, "ai_memory_full", "pending")
}
