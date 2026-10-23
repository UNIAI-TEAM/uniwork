package service

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// evidenceFixture is a live meeting with one transcript segment, one note and
// one chat message, summarized by a model that answers reply(prompt).
func evidenceFixture(t *testing.T, reply func(prompt string) string) (*MeetingService, db.User, db.User, db.Meeting, map[string]string) {
	t.Helper()
	s, ua, ub, w := meetingFixture(t)
	fake := &provider.Fake{Reply: func(req provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: reply(req.Messages[len(req.Messages)-1].Content), Model: "fake", InputTokens: 10, OutputTokens: 10}
	}}
	s.AI = ai.NewGateway(s.q, fake, NewAIQuota(s.ent), nil, ai.Options{})
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Giao ban")
	if err != nil {
		t.Fatal(err)
	}
	seg, err := s.AppendTranscript(ctx, ua.ID, m.ID, "Chốt ship vào thứ Sáu", time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	note, err := s.AddNote(ctx, ua.ID, m.ID, "Nhớ gửi bản nháp")
	if err != nil {
		t.Fatal(err)
	}
	chat, err := s.AppendChatMessage(ctx, ua.ID, "", m.ID, "Tôi gửi báo cáo")
	if err != nil {
		t.Fatal(err)
	}
	return s, ua, ub, m, map[string]string{"segment": seg.ID, "note": note.ID, "chat": chat.ID}
}

// TestSummarizeStoresEvidence (UNI-2002, spec §7.2, §13.1 đợt 6): the prompt
// labels the lines it sends, the server keeps only labels of its own table
// and stores them as {kind, id} on the decisions and the items; an item left
// without valid evidence stays; the audit row counts what was dropped.
func TestSummarizeStoresEvidence(t *testing.T) {
	var prompt string
	s, ua, _, m, ids := evidenceFixture(t, func(p string) string {
		prompt = p
		return `{"summary":"Đã chốt.",
			"decisions":[{"text":"Ship thứ Sáu","evidence":["S1","S9","[n1]","S1"]},"Chuỗi cũ"],
			"action_items":[{"title":"Gửi báo cáo","owner":"","due":"","evidence":["C1","X7"]},{"title":"Tổng hợp ý","owner":"","due":"","evidence":["S42"]}]}`
	})
	ctx := context.Background()
	sum, err := s.Summarize(ctx, ua.ID, m.ID, "vi")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"[S1] A: Chốt ship vào thứ Sáu", "- [N1] A: Nhớ gửi bản nháp", "[C1] A: Tôi gửi báo cáo"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt misses %q:\n%s", want, prompt)
		}
	}
	got := DecodeSummaryDecisions(sum.Decisions)
	want := []SummaryDecision{
		{Text: "Ship thứ Sáu", Evidence: []EvidenceRef{{Kind: EvidenceSegment, ID: ids["segment"]}, {Kind: EvidenceNote, ID: ids["note"]}}},
		{Text: "Chuỗi cũ", Evidence: []EvidenceRef{}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("decisions = %+v, want %+v", got, want)
	}
	items := itemsByTitle(t, s, ua.ID, m)
	if ev := items["Gửi báo cáo"].Evidence; !reflect.DeepEqual(ev, []EvidenceRef{{Kind: EvidenceChat, ID: ids["chat"]}}) {
		t.Fatalf("item evidence = %+v", ev)
	}
	if it, ok := items["Tổng hợp ý"]; !ok || len(it.Evidence) != 0 || it.Evidence == nil {
		t.Fatalf("an item with no valid evidence must stay, with empty evidence: %+v", it)
	}
	var metadata []byte
	if err := s.pool.QueryRow(ctx, `SELECT metadata FROM audit_events WHERE action = $1`, audit.ActionMeetingSummaryCreated).Scan(&metadata); err != nil {
		t.Fatal(err)
	}
	var meta map[string]any
	if err := json.Unmarshal(metadata, &meta); err != nil {
		t.Fatal(err)
	}
	if meta["evidence_dropped"] != float64(3) {
		t.Fatalf("evidence_dropped = %v, want 3 (S9, X7, S42)", meta["evidence_dropped"])
	}

	// A manual item has no evidence.
	manual, err := s.AddActionItem(ctx, ua.ID, m.ID, AddActionItemInput{Title: "Đặt phòng"})
	if err != nil {
		t.Fatal(err)
	}
	if manual.Evidence == nil || len(manual.Evidence) != 0 {
		t.Fatalf("manual evidence = %+v, want []", manual.Evidence)
	}
}

// TestDecodeSummaryDecisions: a summary stored before @5 keeps its decisions
// as strings and still reads; a broken row reads as no decisions.
func TestDecodeSummaryDecisions(t *testing.T) {
	cases := map[string][]SummaryDecision{
		`["Chốt A"," "]`: {{Text: "Chốt A", Evidence: []EvidenceRef{}}},
		`[{"text":"Chốt B","evidence":[{"kind":"note","id":"01N"},{"kind":"bogus","id":"x"},{"kind":"chat"}]}]`: {
			{Text: "Chốt B", Evidence: []EvidenceRef{{Kind: EvidenceNote, ID: "01N"}}},
		},
		`not json`: {},
		``:         {},
	}
	for raw, want := range cases {
		if got := DecodeSummaryDecisions(raw); !reflect.DeepEqual(got, want) {
			t.Errorf("DecodeSummaryDecisions(%q) = %+v, want %+v", raw, got, want)
		}
	}
	if got := summaryDecisionTexts(`[{"text":"Chốt B","evidence":[]},"Chốt A"]`); got != `["Chốt B","Chốt A"]` {
		t.Errorf("summaryDecisionTexts = %s", got)
	}
	// Excerpts quote item titles only: no @5 labels, which would read as Ask UNI's own [S2].
}

// TestMeetingEvidenceSources: a member reads the cited lines in the order
// asked; an id of another meeting is absent; a non-member is refused; a bad
// reference list is invalid.
func TestMeetingEvidenceSources(t *testing.T) {
	s, ua, ub, m, ids := evidenceFixture(t, func(string) string { return `{"summary":"x"}` })
	ctx := context.Background()
	other, err := s.CreateInstant(ctx, ua.ID, m.WorkspaceID, "Họp khác")
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := s.AppendTranscript(ctx, ua.ID, other.ID, "Câu của họp khác", time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	foreignNote, err := s.AddNote(ctx, ua.ID, other.ID, "Ghi chú của họp khác")
	if err != nil {
		t.Fatal(err)
	}
	foreignChat, err := s.AppendChatMessage(ctx, ua.ID, "", other.ID, "Tin của họp khác")
	if err != nil {
		t.Fatal(err)
	}
	// Another organization's meeting, with a note and a chat message of its own.
	orgB, err := NewOrganizationService(s.pool, s.q).Create(ctx, ub.ID, "Org B", "org-bravo")
	if err != nil {
		t.Fatal(err)
	}
	wsB, err := s.ws.CreateInOrg(ctx, ub.ID, orgB.ID, "Bravo", "bravo")
	if err != nil {
		t.Fatal(err)
	}
	mB, err := s.CreateInstant(ctx, ub.ID, wsB.Workspace.ID, "Họp của tổ chức khác")
	if err != nil {
		t.Fatal(err)
	}
	crossNote, err := s.AddNote(ctx, ub.ID, mB.ID, "Ghi chú của tổ chức khác")
	if err != nil {
		t.Fatal(err)
	}
	crossChat, err := s.AppendChatMessage(ctx, ub.ID, "", mB.ID, "Tin của tổ chức khác")
	if err != nil {
		t.Fatal(err)
	}
	refs, err := ParseEvidenceRefs("chat:" + ids["chat"] + ",segment:" + ids["segment"] + ",segment:" + foreign.ID +
		",note:" + foreignNote.ID + ",chat:" + foreignChat.ID + ",note:" + crossNote.ID + ",chat:" + crossChat.ID + ",note:" + ids["note"])
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.EvidenceSources(ctx, ua.ID, m.ID, refs)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("sources = %+v, want 3 (the other meeting's and the other organization's lines absent)", got)
	}
	if got[0].Kind != EvidenceChat || got[0].Text != "Tôi gửi báo cáo" || got[0].Author != "A" ||
		got[1].Kind != EvidenceSegment || got[1].ID != ids["segment"] || got[1].Text != "Chốt ship vào thứ Sáu" || !got[1].At.Valid ||
		got[2].Kind != EvidenceNote || got[2].Text != "Nhớ gửi bản nháp" || got[2].Author != "A" {
		t.Fatalf("sources = %+v", got)
	}
	if _, err := s.EvidenceSources(ctx, ub.ID, m.ID, refs); !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-member: %v", err)
	}
	for _, bad := range []string{"segment", "page:01X", "segment:", strings.Repeat("note:01X,", maxEvidenceRefs+1)} {
		var ve ValidationError
		if _, err := ParseEvidenceRefs(bad); !errors.As(err, &ve) {
			t.Errorf("ParseEvidenceRefs(%q) = %v, want invalid", bad, err)
		}
	}
	if refs, err := ParseEvidenceRefs(""); err != nil || len(refs) != 0 {
		t.Fatalf("no refs: %v %v", refs, err)
	}
}
