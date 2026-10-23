package service

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/document"
)

// askDocWorld is the write world with documents wired into Ask UNI too.
func askDocWorld(t *testing.T) (*mcpToolWorld, *AskUNIService, *DocumentService, McpPrincipal, func(string, string) (AskProposalResult, *askInverse, error), func(*askInverse) error) {
	t.Helper()
	x, s, tc := askWriteWorld(t)
	docs := x.docs(t)
	s.SetDocuments(docs)
	p := principalOf(tc)
	ctx := context.Background()
	run := func(name, args string) (AskProposalResult, *askInverse, error) {
		return writeToolNamed(t, s, name).apply(ctx, p, askPrepare(t, s, tc, name, args))
	}
	undo := func(inv *askInverse) error {
		t.Helper()
		if inv == nil {
			t.Fatal("no inverse")
		}
		return askInverses[inv.Op](ctx, s, p, inv.Args)
	}
	return x, s, docs, p, run, undo
}

func TestAskWriteDocumentLevels(t *testing.T) {
	x, s, tc := askWriteWorld(t)
	_, page := x.withDocs(t, "Kế hoạch", mcpTestPage)
	id := page.Document.ID
	cases := []struct {
		name, tool, args, want string
	}{
		{"create at the root", "create_document", `{"title":"A","content":"x"}`, askLevel1},
		{"create under a page", "create_document", fmt.Sprintf(`{"title":"B","parent_id":%q}`, id), askLevel2},
		{"update", "update_document", fmt.Sprintf(`{"document_id":%q,"title":"C"}`, id), askLevel2},
		{"comment", "add_document_comment", fmt.Sprintf(`{"document_id":%q,"body":"hi"}`, id), askLevel2},
	}
	for _, c := range cases {
		if got := askPrepare(t, s, tc, c.tool, c.args).Level; got != c.want {
			t.Errorf("%s: level %s, want %s", c.name, got, c.want)
		}
	}
	// A row naming an earlier create_document is always l2 and has no revision.
	created := askPrepare(t, s, tc, "create_document", `{"title":"Mới"}`)
	for tool, args := range map[string]string{
		"create_document":      `{"title":"Con","parent_id":"{{row:1.id}}"}`,
		"update_document":      `{"document_id":"{{row:1.id}}","content":"thêm"}`,
		"add_document_comment": `{"document_id":"{{row:1.id}}","body":"chào"}`,
	} {
		row := askPrepare(t, s, tc, tool, args, created)
		if row.Level != askLevel2 || row.TargetRevision != nil || row.TargetID != "" || !slices.Equal(row.Preview.Refs, []int{1}) || row.Preview.Target.Title != map[bool]string{true: "Con", false: "Mới"}[tool == "create_document"] {
			t.Errorf("%s ref row = %+v", tool, row)
		}
	}
	if _, err := writeToolNamed(t, s, "update_document").prepare(context.Background(), tc, json.RawMessage(`{"document_id":"{{row:1.id}}","title":"x"}`), []askDraftRow{{Tool: "create_task"}}); err == nil {
		t.Error("a ref to a task row fed a document")
	}
}

func TestAskWriteDocumentApplyAndUndo(t *testing.T) {
	x, _, docs, _, run, undo := askDocWorld(t)
	ctx := context.Background()
	md := func(id string) string { return x.pageMarkdown(t, id) }
	const old = "## Mục tiêu\n\nTăng doanh thu quý bốn"

	// create → archive
	res, inv, err := run("create_document", `{"title":"Biên bản","content":"nội dung"}`)
	if err != nil || res.ObjectID == "" || inv.Op != "archive_document" || res.Revision != 1 {
		t.Fatalf("create: %+v %v %v", res, inv, err)
	}
	if err := undo(inv); err != nil {
		t.Fatal(err)
	}
	if x.docRow(t, res.ObjectID).ArchivedAt.Valid == false {
		t.Fatal("page not in the trash")
	}
	// a created page someone changed cannot be archived by undo
	res, inv, _ = run("create_document", `{"title":"Biên bản 2"}`)
	nt := "Đổi tên"
	if _, err := docs.UpdateDocument(ctx, Human(x.ua.ID), res.ObjectID, UpdateDocumentInput{Revision: 1, Title: &nt}); err != nil {
		t.Fatal(err)
	}
	assertUndoUnavailable(t, undo(inv))
	if x.docRow(t, res.ObjectID).ArchivedAt.Valid {
		t.Fatal("archived anyway")
	}

	// replace → restore the saved version
	_, page := x.withDocs(t, "Kế hoạch", mcpTestPage)
	id := page.Document.ID
	res, inv, err = run("update_document", fmt.Sprintf(`{"document_id":%q,"content":"## Mới\n\nHoàn toàn khác","mode":"replace"}`, id))
	if err != nil || inv == nil || inv.Op != "restore_document_version" {
		t.Fatalf("replace: %+v %v %v", res, inv, err)
	}
	if got := md(id); got != "## Mới\n\nHoàn toàn khác" {
		t.Fatalf("after replace %q", got)
	}
	if err := undo(inv); err != nil {
		t.Fatal(err)
	}
	if got := md(id); got != old {
		t.Fatalf("not restored: %q", got)
	}
	// The restore above left a version equal to the page, so this edit takes no
	// version of its own: its undo must still find the latest one.
	res, inv, err = run("update_document", fmt.Sprintf(`{"document_id":%q,"content":"## Lại khác","mode":"replace"}`, id))
	if err != nil || inv == nil || !strings.Contains(res.Note, "already the latest version") {
		t.Fatalf("replace on a saved page: %+v %v %v", res, inv, err)
	}
	if err := undo(inv); err != nil {
		t.Fatal(err)
	}
	if got := md(id); got != old {
		t.Fatalf("not restored when the page equalled the latest version: %q", got)
	}
	// someone edits after → undo refuses and writes nothing
	_, inv, _ = run("update_document", fmt.Sprintf(`{"document_id":%q,"content":"thêm","mode":"append"}`, id))
	cur := x.docRow(t, id)
	nt = "Người khác sửa"
	if _, err := docs.UpdateDocument(ctx, Human(x.ua.ID), id, UpdateDocumentInput{Revision: cur.Revision, Title: &nt}); err != nil {
		t.Fatal(err)
	}
	assertUndoUnavailable(t, undo(inv))
	if got := md(id); !strings.HasSuffix(got, "thêm") {
		t.Fatalf("undo wrote: %q", got)
	}

	// rename → rename back; content and title together restore both
	_, page = x.withDocs(t, "Tên cũ", mcpTestPage)
	id = page.Document.ID
	_, inv, err = run("update_document", fmt.Sprintf(`{"document_id":%q,"title":"Tên mới"}`, id))
	if err != nil {
		t.Fatal(err)
	}
	if err := undo(inv); err != nil {
		t.Fatal(err)
	}
	if got := x.docRow(t, id).Title; got != "Tên cũ" {
		t.Fatalf("title %q", got)
	}
	_, inv, err = run("update_document", fmt.Sprintf(`{"document_id":%q,"title":"Tên mới","content":"## Khác","mode":"replace"}`, id))
	if err != nil {
		t.Fatal(err)
	}
	if err := undo(inv); err != nil {
		t.Fatal(err)
	}
	if row := x.docRow(t, id); row.Title != "Tên cũ" || md(id) != old {
		t.Fatalf("title %q content %q", row.Title, md(id))
	}

	// comment → delete the comment
	res, inv, err = run("add_document_comment", fmt.Sprintf(`{"document_id":%q,"body":"xin chào"}`, id))
	if err != nil || inv.Op != "delete_document_comment" || res.ObjectID == "" {
		t.Fatalf("comment: %+v %v %v", res, inv, err)
	}
	if n := x.commentRows(t, id); n != 1 {
		t.Fatalf("%d comments", n)
	}
	if err := undo(inv); err != nil {
		t.Fatal(err)
	}
	if n := x.commentRows(t, id); n != 0 {
		t.Fatalf("%d comments left", n)
	}
}

func TestAskWriteDocumentPreviewShowsTheBody(t *testing.T) {
	x, s, tc := askWriteWorld(t)
	_, page := x.withDocs(t, "Kế hoạch", mcpTestPage)
	id := page.Document.ID

	row := askPrepare(t, s, tc, "create_document", `{"title":"Riêng","content":"dòng 1\n\ndòng 2"}`)
	if row.Preview.Body != "dòng 1\n\ndòng 2" || row.Preview.Audience.Visibility != "private" || row.Preview.Target.Kind != "document" || row.Preview.Target.Title != "Riêng" {
		t.Fatalf("create preview = %+v", row.Preview)
	}
	long := strings.Repeat("a", mcpMaxItemRunes+50)
	if mcpMaxItemRunes+50 <= document.MaxMarkdownRunes {
		row = askPrepare(t, s, tc, "create_document", fmt.Sprintf(`{"title":"Dài","content":%q}`, long))
		if got := len([]rune(row.Preview.Body)); got != mcpMaxItemRunes {
			t.Errorf("body holds %d characters, want %d", got, mcpMaxItemRunes)
		}
	}
	under := askPrepare(t, s, tc, "create_document", fmt.Sprintf(`{"title":"Con","parent_id":%q}`, id))
	if under.Preview.Audience.Visibility != "workspace" {
		t.Errorf("a page under a workspace page: %+v", under.Preview.Audience)
	}

	row = askPrepare(t, s, tc, "update_document", fmt.Sprintf(`{"document_id":%q,"content":"## Thêm","title":"Tên mới"}`, id))
	f := row.Preview.Fields
	if row.Preview.Body != "## Thêm" || len(f) != 2 || f[0].Field != "title" || f[0].From != "Kế hoạch" || f[0].To != "Tên mới" || f[1].Field != "content" || f[1].Type != "markdown" ||
		row.TargetRevision == nil || *row.TargetRevision != page.Document.Revision || row.Preview.Target.ID != id {
		t.Fatalf("update preview = %+v (%v)", row.Preview, row.TargetRevision)
	}

	row = askPrepare(t, s, tc, "add_document_comment", fmt.Sprintf(`{"document_id":%q,"body":"dòng 1\ndòng 2 [@Bình](mention://member/%s)"}`, id, x.ub.ID))
	if row.Preview.Body != "dòng 1\ndòng 2 [@Bình](mention://member/"+x.ub.ID+")" || row.Preview.Audience.Visibility != "document" ||
		len(row.Preview.Audience.Notifies) != 1 || row.Preview.Audience.Notifies[0].ID != x.ub.ID || row.Preview.Target.ID != id {
		t.Fatalf("comment preview = %+v", row.Preview)
	}

	// Refusals the connector makes are made before a row exists.
	for tool, args := range map[string]string{
		"update_document":      fmt.Sprintf(`{"document_id":%q}`, id),
		"update_document ":     fmt.Sprintf(`{"document_id":%q,"title":"Kế hoạch"}`, id),
		"update_document  ":    fmt.Sprintf(`{"document_id":%q,"content":"","mode":"append"}`, id),
		"add_document_comment": fmt.Sprintf(`{"document_id":%q,"body":"  "}`, id),
		"create_document":      `{"title":" "}`,
	} {
		if _, err := writeToolNamed(t, s, strings.TrimSpace(tool)).prepare(context.Background(), tc, json.RawMessage(args), nil); err == nil {
			t.Errorf("%s(%s) was accepted", tool, args)
		}
	}
}
