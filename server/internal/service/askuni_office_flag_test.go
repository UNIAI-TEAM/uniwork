package service

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// officeSwitch has ask_uni_agent and ask_uni_actions on and ask_uni_office as set: byOrg by the
// request's organization, else global. Every other flag reads as its default.
type officeSwitch struct {
	global bool
	byOrg  map[string]bool
}

func (f officeSwitch) IsEnabled(ctx context.Context, key string, def bool) bool {
	switch key {
	case askActionsFlag, askAgentFlag:
		return true
	case askOfficeFlag:
		if v, ok := f.byOrg[featureflag.EvalContextFrom(ctx).OrganizationID]; ok {
			return v
		}
		return f.global
	}
	return def
}

// officeFlagWorld is the actions world with the office flag as sw says.
func officeFlagWorld(t *testing.T, sw officeSwitch) *actWorld {
	t.Helper()
	w := newActWorld(t, AskModeAsk)
	w.s.SetFlags(sw)
	w.s.SetDocuments(w.x.docs(t))
	w.s.SetFiles(w.x.files)
	return w
}

// toolNames is the tools the first request of a dock turn carried.
func (w *actWorld) dockToolNames(t *testing.T, tc ai.ToolContext) []string {
	t.Helper()
	seen := scriptCalls(w.fake, "Xong.")
	if _, err := w.s.AskStream(context.Background(), tc.ActorID, tc.WorkspaceID, AskInput{Dock: true, Locale: "vi", Question: "Giúp mình việc này"}, nil); err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, tool := range (*seen)[0].Tools {
		names = append(names, tool.Name)
	}
	return names
}

func TestAskUniOfficeFlagHidesItsTools(t *testing.T) {
	w := officeFlagWorld(t, officeSwitch{})
	got := w.dockToolNames(t, w.tc)
	for name := range askOfficeTools {
		if slices.Contains(got, name) {
			t.Fatalf("flag off: tool %s is offered in %v", name, got)
		}
	}
	for _, name := range []string{"get_document", "list_documents", "create_task"} {
		if !slices.Contains(got, name) {
			t.Fatalf("flag off: %s missing from %v", name, got)
		}
	}
	w.s.SetFlags(officeSwitch{global: true})
	got = w.dockToolNames(t, w.tc)
	for name := range askOfficeTools {
		if !slices.Contains(got, name) {
			t.Fatalf("flag on: %s missing from %v", name, got)
		}
	}
}

func TestAskUniOfficeFlagFollowsTheOrganization(t *testing.T) {
	w := officeFlagWorld(t, officeSwitch{byOrg: map[string]bool{}})
	w.s.SetFlags(officeSwitch{byOrg: map[string]bool{w.x.w.OrganizationID: true}})
	if got := w.dockToolNames(t, w.tc); !slices.Contains(got, "create_office_document") || !slices.Contains(got, "list_templates") {
		t.Fatalf("organization A with the override: %v", got)
	}
	w.s.SetFlags(officeSwitch{byOrg: map[string]bool{"01OTHERORGANIZATION00000": true}})
	if got := w.dockToolNames(t, w.tc); slices.Contains(got, "create_office_document") || slices.Contains(got, "list_templates") {
		t.Fatalf("organization B without the override: %v", got)
	}
}

func TestAskUniOfficeFlagRefusesApply(t *testing.T) {
	w := officeFlagWorld(t, officeSwitch{global: true})
	s, x, tc := w.s, w.x, w.tc
	ctx := context.Background()
	row := askPrepare(t, s, tc, "create_office_document", `{"title":"Đề xuất","format":"docx","outline":"## A"}`)
	convID, msgID := askAnswer(t, s, tc, "x", nil)
	pr := propose(t, s, tc, convID, msgID, AskModeAsk, row)[0]
	s.SetFlags(officeSwitch{global: false})
	docs := x.docRows(t)
	_, err := s.ApplyProposal(ctx, x.ua.ID, pr.ID)
	if ce, ok := err.(CodedError); !ok || ce.Code != "ask_uni_office_off" || ce.Status != 403 {
		t.Fatalf("apply with the flag off: %v, want ask_uni_office_off 403", err)
	}
	if after := x.docRows(t); after != docs {
		t.Fatalf("documents %d -> %d", docs, after)
	}
	if n := x.count(t, `SELECT count(*) FROM ai_office_handoffs WHERE organization_id = $1`, x.w.OrganizationID); n != 0 {
		t.Fatalf("%d handoff rows, want none", n)
	}
	if got, err := s.ownProposal(ctx, x.ua.ID, pr.ID); err != nil || got.Status != proposalPending {
		t.Fatalf("row after the refusal: %+v, %v; want pending", got.Status, err)
	}
}

func TestAskUniOfficeFlagKeepsOfficeReads(t *testing.T) {
	w := officeFlagWorld(t, officeSwitch{})
	const ns = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`
	id := w.x.textFile(t, "bao-gia.docx", officeFile(t, map[string]string{"word/document.xml": `<w:document ` + ns + `><w:body><w:p><w:r><w:t>Báo giá tháng 10</w:t></w:r></w:p></w:body></w:document>`}))
	seen := scriptCalls(w.fake, "Xong.", []provider.ToolCall{toolCall("c1", "get_document", `{"document_id":"`+id+`"}`)})
	if _, err := w.s.AskStream(context.Background(), w.x.ua.ID, w.x.w.ID, AskInput{Dock: true, Locale: "vi", Question: "Đọc tệp"}, nil); err != nil {
		t.Fatal(err)
	}
	if len(*seen) < 2 {
		t.Fatalf("%d requests, want the tool round", len(*seen))
	}
	read := false
	for _, m := range (*seen)[1].Messages {
		read = read || (m.Role == "tool" && strings.Contains(m.Content, "Báo giá tháng 10"))
	}
	if !read {
		t.Fatalf("get_document did not return the file's text: %+v", (*seen)[1].Messages)
	}
}

// The editor AI's own gate is not this flag's: with ask_uni_office on and the
// editor AI off, the file is still drafted, with no package.
func TestAskUniOfficeFlagLeavesTheEditorGateAlone(t *testing.T) {
	w := officeFlagWorld(t, officeSwitch{global: true})
	w.s.SetOffice(NewDocumentOfficeService(DocumentOfficeOptions{Pool: w.s.pool, Queries: w.s.q, Files: w.x.files, Documents: w.x.docs(t)}))
	w.s.SetEditorAI(&editorAIFake{reason: "off"})
	row := askPrepare(t, w.s, w.tc, "create_office_document", `{"title":"Đề xuất","format":"docx","outline":"## A\n## B","instructions":"Viết ngắn."}`)
	if f, _ := officeField(row, "editor_ai"); f.To != "off" {
		t.Fatalf("editor_ai = %v, want off", f.To)
	}
	p := applyOffice(t, w.s, w.tc, w.x.ua.ID, row)
	if p.Result.ObjectID == "" || p.Result.HandoffID != "" {
		t.Fatalf("result = %+v, want a document and no handoff_id", p.Result)
	}
}
