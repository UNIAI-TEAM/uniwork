package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/util"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// docs wires a DocumentService into the world once: pages need nothing more,
// files run on the FileService fake.
func (x *mcpToolWorld) docs(t *testing.T) *DocumentService {
	t.Helper()
	if x.tools.docs != nil {
		return x.tools.docs
	}
	docs := NewDocumentService(x.tools.ask.pool, x.tools.q, x.tools.ask.orgs, x.tools.ws)
	docs.SetFiles(filesfake.New(filesfake.Options{}))
	docs.SetEntitlements(NewEntitlementService(x.tools.ask.pool, x.tools.q))
	docs.store.spoolDir = t.TempDir()
	x.tools.SetDocuments(docs)
	x.flags = &mcpFlagFake{}
	x.tools.SetFlags(x.flags)
	return docs
}

// mcpFlagFake is the flag evaluator of the connector's tools: a flag reads as
// the registry default it is asked with unless an organization is set, and
// every evaluation is kept to show who it was asked for.
type mcpFlagFake struct {
	byOrg map[string]bool
	asked []mcpFlagAsk
}

type mcpFlagAsk struct {
	key, user, org string
	def            bool
}

func (f *mcpFlagFake) IsEnabled(ctx context.Context, key string, def bool) bool {
	ec := featureflag.EvalContextFrom(ctx)
	f.asked = append(f.asked, mcpFlagAsk{key, ec.UserID, ec.OrganizationID, def})
	if v, ok := f.byOrg[ec.OrganizationID]; ok {
		return v
	}
	return def
}

// withDocs wires a DocumentService into the world and creates one page.
func (x *mcpToolWorld) withDocs(t *testing.T, title, content string) (*DocumentService, DocumentView) {
	t.Helper()
	docs := x.docs(t)
	v, err := docs.CreatePage(context.Background(), Human(x.ua.ID), x.w.ID, CreatePageInput{Title: title, Content: json.RawMessage(content)})
	if err != nil {
		t.Fatal(err)
	}
	return docs, v
}

const mcpTestPage = `{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Mục tiêu"}]},{"type":"paragraph","content":[{"type":"text","text":"Tăng doanh thu quý bốn"}]}]}`

// getDoc runs get_document in the world's workspace as the world's person.
func (x *mcpToolWorld) getDoc(t *testing.T, id string) McpDocument {
	t.Helper()
	raw, err := callMcpTool(t, x.tools, x.p, "get_document", `{"workspace_id":"`+x.w.ID+`","document_id":"`+id+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	var d McpDocument
	if err := json.Unmarshal(raw, &d); err != nil {
		t.Fatalf("get_document = %s (%v)", raw, err)
	}
	return d
}

// docList runs list_documents on the world's workspace with extra JSON fields
// (without braces) as the given person.
func (x *mcpToolWorld) docList(t *testing.T, p McpPrincipal, extra string) (McpDocumentList, error) {
	t.Helper()
	input := `{"workspace_id":"` + x.w.ID + `"`
	if extra != "" {
		input += "," + extra
	}
	raw, err := callMcpTool(t, x.tools, p, "list_documents", input+"}")
	if err != nil {
		return McpDocumentList{}, err
	}
	var list McpDocumentList
	if err := json.Unmarshal(raw, &list); err != nil {
		t.Fatalf("list_documents = %s (%v)", raw, err)
	}
	return list, nil
}

func docIDs(list McpDocumentList) []string {
	out := make([]string, 0, len(list.Documents))
	for _, d := range list.Documents {
		out = append(out, d.ID)
	}
	return out
}

func (x *mcpToolWorld) searchIDs(t *testing.T, p McpPrincipal, query string) []string {
	t.Helper()
	raw, err := callMcpTool(t, x.tools, p, "search", `{"workspace_id":"`+x.w.ID+`","query":"`+query+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	var items []McpItem
	if err := json.Unmarshal(raw, &items); err != nil {
		t.Fatalf("search = %s (%v)", raw, err)
	}
	out := []string{}
	for _, it := range items {
		out = append(out, it.ID)
	}
	return out
}

// textFile makes a file document of text bytes in the world's workspace.
func (x *mcpToolWorld) textFile(t *testing.T, filename string, body []byte) string {
	t.Helper()
	res, err := x.docs(t).CreateFileDocument(context.Background(), Human(x.ua.ID), x.w.ID, CreateFileDocumentInput{Title: "Tệp " + filename, Filename: filename, Body: bytes.NewReader(body)})
	if err != nil {
		t.Fatal(err)
	}
	return res.Document.ID
}

func TestMcpGetDocumentReturnsMarkdown(t *testing.T) {
	x := newMcpToolWorld(t)
	_, v := x.withDocs(t, "Kế hoạch Q4", mcpTestPage)
	raw, err := callMcpTool(t, x.tools, x.p, "get_document", `{"workspace_id":"`+x.w.ID+`","document_id":"`+v.Document.ID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	var d McpDocument
	if err := json.Unmarshal(raw, &d); err != nil || d.Format != "markdown" || d.Content != "## Mục tiêu\n\nTăng doanh thu quý bốn" || d.Revision != v.Document.Revision || d.Lossy {
		t.Fatalf("get_document = %s (%v)", raw, err)
	}
	if d.Kind != "document" || d.DocKind != "page" || d.Title != "Kế hoạch Q4" || d.WorkspaceID != x.w.ID || d.URL != "https://app.example.test/"+x.tools.mustBase(t, x.w.ID)+"/documents/"+v.Document.ID {
		t.Fatalf("get_document identity = %s", raw)
	}
}

func (s *McpToolService) mustBase(t *testing.T, workspaceID string) string {
	t.Helper()
	base, err := s.ask.base(context.Background(), workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimPrefix(base, "/")
}

func TestMcpSearchFindsDocumentsAndListDocuments(t *testing.T) {
	x := newMcpToolWorld(t)
	task := x.task(t, x.ua.ID, x.w.ID, "Doanh thu tháng mười")
	_, v := x.withDocs(t, "Kế hoạch doanh thu", mcpTestPage)
	raw, err := callMcpTool(t, x.tools, x.p, "search", `{"workspace_id":"`+x.w.ID+`","query":"doanh thu"}`)
	if err != nil || !strings.Contains(string(raw), v.Document.ID) || !strings.Contains(string(raw), `"kind":"document"`) {
		t.Fatalf("search = %s (%v)", raw, err)
	}
	var items []McpItem
	if err := json.Unmarshal(raw, &items); err != nil {
		t.Fatal(err)
	}
	// Tasks and meetings come first, then the documents.
	if len(items) != 2 || items[0].ID != task.ID || items[1].ID != v.Document.ID || !strings.Contains(items[1].Excerpt, "Tăng doanh thu") {
		t.Fatalf("search order = %+v", items)
	}
	raw, err = callMcpTool(t, x.tools, x.p, "list_documents", `{"workspace_id":"`+x.w.ID+`"}`)
	if err != nil || !strings.Contains(string(raw), v.Document.ID) || !strings.HasPrefix(string(raw), `{"documents":[`) {
		t.Fatalf("list_documents = %s (%v)", raw, err)
	}
}

func TestMcpDocumentToolsWithoutDocumentsAreUnavailable(t *testing.T) {
	x := newMcpToolWorld(t)
	for _, call := range []struct{ tool, input string }{
		{"get_document", `{"workspace_id":"` + x.w.ID + `","document_id":"01J0000000000000000000000X"}`},
		{"list_documents", `{"workspace_id":"` + x.w.ID + `"}`},
	} {
		_, err := callMcpTool(t, x.tools, x.p, call.tool, call.input)
		var te McpToolError
		if !errors.As(err, &te) || te.Code != "documents_unavailable" {
			t.Fatalf("%s without a DocumentService: %v", call.tool, err)
		}
	}
	// Search still answers with what it has.
	if ids := x.searchIDs(t, x.p, "báo cáo"); len(ids) != 1 || ids[0] != x.taskID {
		t.Fatalf("search without documents = %v, want the task", ids)
	}
}

func TestMcpTextFile(t *testing.T) {
	for _, c := range []struct {
		mime, name string
		want       bool
	}{
		{"text/markdown", "a.md", true}, {"text/html", "a.html", true}, {"text/plain", "a.txt", true},
		{"application/octet-stream", "notes.md", true}, {"text/plain; charset=utf-8", "ghi-chu", true}, {"Text/Markdown", "", true},
		{"application/pdf", "a.pdf", false}, {"application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx", false},
	} {
		if got := mcpTextFile(c.mime, c.name); got != c.want {
			t.Errorf("mcpTextFile(%q, %q) = %v", c.mime, c.name, got)
		}
	}
}

// A page that Markdown cannot carry back says so; a long one is cut and says
// so too, and the two flags are independent.
func TestMcpGetDocumentFlagsLossyAndCutPages(t *testing.T) {
	x := newMcpToolWorld(t)
	_, blank := x.withDocs(t, "Có dòng trống", `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]},{"type":"paragraph"},{"type":"paragraph","content":[{"type":"text","text":"b"}]}]}`)
	if d := x.getDoc(t, blank.Document.ID); !d.Lossy || d.Truncated || d.Format != "markdown" {
		t.Errorf("page with a blank paragraph = %+v, want lossy", d)
	}

	var paras []string
	for i := 0; i < 400; i++ {
		paras = append(paras, `{"type":"paragraph","content":[{"type":"text","text":"Dòng số `+strconv.Itoa(i)+` của một trang rất dài, đủ để vượt giới hạn."}]}`)
	}
	_, long := x.withDocs(t, "Trang dài", `{"type":"doc","content":[`+strings.Join(paras, ",")+`]}`)
	d := x.getDoc(t, long.Document.ID)
	if !d.Truncated || d.Lossy || utf8.RuneCountInString(d.Content) > mcpMaxItemRunes || !strings.HasSuffix(d.Content, mcpItemCut) || !strings.HasPrefix(d.Content, "Dòng số 0 của") {
		t.Errorf("long page: truncated=%v lossy=%v runes=%d", d.Truncated, d.Lossy, utf8.RuneCountInString(d.Content))
	}
}

// document() reads one live document of the workspace, as the person. It
// checks the grant itself, so no tool that reaches a document can forget to.
func TestMcpDocumentLookupStaysInTheGrantAndTheWorkspace(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	docs, v := x.withDocs(t, "Trong workspace", mcpTestPage)
	if got, err := x.tools.document(ctx, x.p, x.w.ID, v.Document.ID); err != nil || got.Document.ID != v.Document.ID {
		t.Fatalf("control: %+v, %v", got, err)
	}
	_, unknown := x.tools.document(ctx, x.p, x.w.ID, util.NewID())
	if !errors.Is(unknown, ErrNotFound) {
		t.Fatalf("unknown document: %v", unknown)
	}

	// A document of another workspace of the same organization, one of a
	// workspace the person belongs to in another organization, and the
	// workspace outside the grant.
	sibling, err := x.tools.ws.CreateInOrg(ctx, x.ua.ID, x.w.OrganizationID, "WS khác", "ws-khac")
	if err != nil {
		t.Fatal(err)
	}
	inSibling, err := docs.CreatePage(ctx, Human(x.ua.ID), sibling.Workspace.ID, CreatePageInput{Title: "Ở workspace khác", Content: json.RawMessage(mcpTestPage)})
	if err != nil {
		t.Fatal(err)
	}
	_, other := x.org(t, x.ua.ID, "Khác", "khac")
	inOther, err := docs.CreatePage(ctx, Human(x.ua.ID), other.ID, CreatePageInput{Title: "Ở tổ chức khác", Content: json.RawMessage(mcpTestPage)})
	if err != nil {
		t.Fatal(err)
	}
	for name, id := range map[string]string{"sibling workspace": inSibling.Document.ID, "other organization": inOther.Document.ID} {
		if _, err := x.tools.document(ctx, x.p, x.w.ID, id); !errors.Is(err, ErrNotFound) || err.Error() != unknown.Error() {
			t.Errorf("document of %s: %v, want %v", name, err, unknown)
		}
	}
	outside := McpPrincipal{UserID: x.ua.ID, OrganizationID: "01NOSUCHORGANIZATION"}
	if _, err := x.tools.document(ctx, outside, x.w.ID, v.Document.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("workspace outside the grant: %v, want ErrNotFound", err)
	}
	for _, args := range []string{
		`{"workspace_id":"` + other.ID + `","document_id":"` + inOther.Document.ID + `"}`,
		`{"workspace_id":"` + x.w.ID + `","document_id":"` + inOther.Document.ID + `"}`,
	} {
		if _, err := callMcpTool(t, x.tools, x.p, "get_document", args); !errors.Is(err, ErrNotFound) {
			t.Errorf("get_document %s: %v, want ErrNotFound", args, err)
		}
	}
	if _, err := callMcpTool(t, x.tools, x.p, "list_documents", `{"workspace_id":"`+other.ID+`"}`); !errors.Is(err, ErrNotFound) {
		t.Errorf("list_documents outside the grant: %v, want ErrNotFound", err)
	}

	// A blank id is a mistake for the model to correct, not a lookup.
	for _, id := range []string{"", "   "} {
		if _, err := x.tools.document(ctx, x.p, x.w.ID, id); !errors.As(err, new(McpInvalidArgs)) || !strings.Contains(err.Error(), "document_id is required") {
			t.Errorf("document %q: %v, want McpInvalidArgs", id, err)
		}
	}

	// A document in the trash reads as absent, even to the person who may restore it.
	if _, err := docs.ArchiveDocument(ctx, Human(x.ua.ID), v.Document.ID, ArchiveDocumentInput{}); err != nil {
		t.Fatal(err)
	}
	if _, err := x.tools.document(ctx, x.p, x.w.ID, v.Document.ID); !errors.Is(err, ErrNotFound) || err.Error() != unknown.Error() {
		t.Errorf("archived document: %v, want %v", err, unknown)
	}
	if ids := x.searchIDs(t, x.p, "Trong workspace"); len(ids) != 0 {
		t.Errorf("search found an archived document: %v", ids)
	}
}

// Documents keep their own permission ladder: a restricted page or folder is
// the person's to read only when it was shared with them, and then in get,
// list and search alike.
func TestMcpDocumentsKeepTheirOwnPermissions(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	docs, open := x.withDocs(t, "Kế hoạch công khai", mcpTestPage)
	secret, err := docs.CreatePage(ctx, Human(x.ua.ID), x.w.ID, CreatePageInput{Title: "Kế hoạch riêng tư", Visibility: documentVisibilityRestricted, Content: json.RawMessage(mcpTestPage)})
	if err != nil {
		t.Fatal(err)
	}
	folder, err := docs.CreatePage(ctx, Human(x.ua.ID), x.w.ID, CreatePageInput{Kind: DocumentKindFolder, Title: "Kế hoạch nội bộ", Visibility: documentVisibilityRestricted})
	if err != nil {
		t.Fatal(err)
	}
	// The control: the creator reads all three.
	for _, id := range []string{open.Document.ID, secret.Document.ID, folder.Document.ID} {
		if d := x.getDoc(t, id); d.ID != id {
			t.Fatalf("creator reads %+v", d)
		}
	}
	member := x.member(t)
	only := func(label string, want ...string) {
		t.Helper()
		list, err := x.docList(t, member, "")
		if err != nil || !sameIDs(docIDs(list), want...) {
			t.Errorf("%s: member's list = %v, %v; want %v", label, docIDs(list), err, want)
		}
		if found := x.searchIDs(t, member, "Kế hoạch"); !sameIDs(found, want...) {
			t.Errorf("%s: member's search = %v; want %v", label, found, want)
		}
	}
	only("before the share", open.Document.ID)
	_, unknown := x.tools.document(ctx, member, x.w.ID, util.NewID())
	for _, id := range []string{secret.Document.ID, folder.Document.ID} {
		if _, err := x.tools.document(ctx, member, x.w.ID, id); !errors.Is(err, ErrNotFound) || err.Error() != unknown.Error() {
			t.Errorf("member reads a restricted document: %v, want %v", err, unknown)
		}
	}

	// Shared with the member, both come in: get, list and search.
	for _, id := range []string{secret.Document.ID, folder.Document.ID} {
		if _, err := docs.ShareDocument(ctx, Human(x.ua.ID), id, DocumentShareInput{PrincipalType: DocumentPrincipalUser, PrincipalID: member.UserID, Level: DocumentLevelView}); err != nil {
			t.Fatal(err)
		}
	}
	only("after the share", open.Document.ID, secret.Document.ID, folder.Document.ID)
	for _, id := range []string{secret.Document.ID, folder.Document.ID} {
		raw, err := callMcpTool(t, x.tools, member, "get_document", `{"workspace_id":"`+x.w.ID+`","document_id":"`+id+`"}`)
		if err != nil || !strings.Contains(string(raw), id) {
			t.Errorf("member reads the shared document %s: %s (%v)", id, raw, err)
		}
	}
}

// A document a work product owns (ADR 0016) is that product's to show: it
// never appears in search or a list, and a read by id answers to the owner's
// resolver as the screens do.
func TestMcpWorkProductDocumentsStayOutOfSearchAndList(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	docs, control := x.withDocs(t, "Hợp đồng bán hàng", mcpTestPage)
	owned := util.NewID()
	title := "Hợp đồng của sản phẩm"
	insertRow(t, ctx, x.tools.ask.pool, "documents", baseDoc(map[string]any{
		"id": owned, "organization_id": x.w.OrganizationID, "workspace_id": x.w.ID, "title": title,
		"created_by": x.ua.ID, "updated_by": x.ua.ID, "owner_kind": "work_product", "owner_id": util.NewID(),
		"search_text": foldForSearch(title), "content_text": "nội dung",
	}))

	if ids := x.searchIDs(t, x.p, "Hợp đồng"); len(ids) != 1 || ids[0] != control.Document.ID {
		t.Fatalf("search = %v, want only %s", ids, control.Document.ID)
	}
	list, err := x.docList(t, x.p, "")
	if err != nil || len(list.Documents) != 1 || list.Documents[0].ID != control.Document.ID {
		t.Fatalf("list_documents = %+v, %v; want only the page", list, err)
	}

	// Read by id, the owner's resolver decides: none by default, view when it says so.
	_, unknown := x.tools.document(ctx, x.p, x.w.ID, util.NewID())
	if _, err := x.tools.document(ctx, x.p, x.w.ID, owned); !errors.Is(err, ErrNotFound) || err.Error() != unknown.Error() {
		t.Fatalf("owned document with no resolver: %v, want %v", err, unknown)
	}
	docs.SetOwnerLevelResolver(grantOwnerLevel{DocumentLevelView})
	if d := x.getDoc(t, owned); d.Title != title || d.DocKind != "page" {
		t.Fatalf("owned document with a view grant = %+v", d)
	}
	if ids := x.searchIDs(t, x.p, "Hợp đồng"); len(ids) != 1 {
		t.Fatalf("search after the grant = %v, want it unchanged", ids)
	}
}

type grantOwnerLevel struct{ level DocumentLevel }

func (g grantOwnerLevel) Resolve(context.Context, Actor, string) (DocumentLevel, error) {
	return g.level, nil
}

func TestMcpListDocumentsByParentAndCursor(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	docs, page := x.withDocs(t, "Trang gốc", mcpTestPage)
	folder, err := docs.CreatePage(ctx, Human(x.ua.ID), x.w.ID, CreatePageInput{Kind: DocumentKindFolder, Title: "Thư mục"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := docs.CreatePage(ctx, Human(x.ua.ID), x.w.ID, CreatePageInput{ParentID: folder.Document.ID, Title: "Trang con", Content: json.RawMessage(mcpTestPage)})
	if err != nil {
		t.Fatal(err)
	}

	roots, err := x.docList(t, x.p, "")
	if err != nil || len(roots.Documents) != 2 || roots.NextCursor != "" {
		t.Fatalf("roots = %+v, %v", roots, err)
	}
	byID := map[string]McpDocument{}
	for _, d := range roots.Documents {
		byID[d.ID] = d
	}
	if byID[page.Document.ID].DocKind != "page" || byID[folder.Document.ID].DocKind != "folder" || byID[child.Document.ID].ID != "" {
		t.Fatalf("roots = %+v", roots)
	}
	// A folder is a query on the documents page, as the web's paths build it.
	if want := "https://app.example.test/" + x.tools.mustBase(t, x.w.ID) + "/documents?folder=" + folder.Document.ID; byID[folder.Document.ID].URL != want {
		t.Errorf("folder url = %s, want %s", byID[folder.Document.ID].URL, want)
	}
	if d := byID[page.Document.ID]; d.Content != "" || d.Excerpt != "" || d.Revision != page.Document.Revision || d.ParentID != "" {
		t.Errorf("a list row carries get_document's fields: %+v", d)
	}

	under, err := x.docList(t, x.p, `"parent_id":"`+folder.Document.ID+`"`)
	if err != nil || len(under.Documents) != 1 || under.Documents[0].ID != child.Document.ID || under.Documents[0].ParentID != folder.Document.ID {
		t.Fatalf("under the folder = %+v, %v", under, err)
	}
	// A folder reads as itself, without content.
	if d := x.getDoc(t, folder.Document.ID); d.DocKind != "folder" || d.Content != "" || d.Format != "" {
		t.Errorf("folder = %+v", d)
	}
	// A parent nobody has lists nothing, the same for any id.
	none, err := x.docList(t, x.p, `"parent_id":"`+util.NewID()+`"`)
	if err != nil || len(none.Documents) != 0 {
		t.Errorf("unknown parent = %+v, %v", none, err)
	}
	for _, extra := range []string{`"parent_id":"  "`, `"cursor":"not-a-cursor"`} {
		if _, err := x.docList(t, x.p, extra); !errors.As(err, new(McpInvalidArgs)) {
			t.Errorf("list_documents %s: %v, want McpInvalidArgs", extra, err)
		}
	}

	// Fifty at a time, the rest behind next_cursor: the page and the folder above
	// and forty-nine more make fifty-one roots.
	want := map[string]bool{page.Document.ID: true, folder.Document.ID: true}
	for i := 0; i < mcpMaxList-1; i++ {
		id := util.NewID()
		insertRow(t, ctx, x.tools.ask.pool, "documents", baseDoc(map[string]any{
			"id": id, "organization_id": x.w.OrganizationID, "workspace_id": x.w.ID, "title": "Hàng " + strconv.Itoa(i),
			"created_by": x.ua.ID, "updated_by": x.ua.ID,
		}))
		want[id] = true
	}
	first, err := x.docList(t, x.p, "")
	if err != nil || len(first.Documents) != mcpMaxList || first.NextCursor == "" {
		t.Fatalf("first page = %d rows, cursor %q, %v", len(first.Documents), first.NextCursor, err)
	}
	second, err := x.docList(t, x.p, `"cursor":"`+first.NextCursor+`"`)
	if err != nil || len(second.Documents) != 1 || second.NextCursor != "" {
		t.Fatalf("second page = %+v, %v", second, err)
	}
	got := map[string]bool{}
	for _, id := range append(docIDs(first), docIDs(second)...) {
		got[id] = true
	}
	if len(got) != len(want) {
		t.Fatalf("pages hold %d distinct documents, want %d", len(got), len(want))
	}
	for id := range want {
		if !got[id] {
			t.Errorf("document %s is on neither page", id)
		}
	}
}

// A text file comes back as text, cut where a page is cut; any other file as
// its name and type, with the reason.
func TestMcpGetDocumentReadsTextFiles(t *testing.T) {
	x := newMcpToolWorld(t)
	md := x.textFile(t, "ghi-chu.md", []byte("# Ghi chú\n\nHọp lúc 10 giờ"))
	d := x.getDoc(t, md)
	if d.DocKind != "file" || d.Format != "text" || d.Content != "# Ghi chú\n\nHọp lúc 10 giờ" || d.Truncated || d.Filename != "ghi-chu.md" || d.Lossy || d.Note != "" {
		t.Fatalf("markdown file = %+v", d)
	}
	if d.MimeType == "" {
		t.Errorf("file without a mime type: %+v", d)
	}

	// More than a read holds, in three-byte characters so that the cut falls
	// inside one: what comes back is whole characters, never a garbled tail.
	long := x.textFile(t, "dai.txt", []byte(strings.Repeat("ế", 40000)))
	d = x.getDoc(t, long)
	if d.Format != "text" || !d.Truncated || utf8.RuneCountInString(d.Content) > mcpMaxItemRunes || !strings.HasSuffix(d.Content, mcpItemCut) || strings.ContainsRune(d.Content, utf8.RuneError) || !utf8.ValidString(d.Content) {
		t.Fatalf("long text file: format=%q truncated=%v runes=%d", d.Format, d.Truncated, utf8.RuneCountInString(d.Content))
	}

	// A file that is not text is not read: name, type and the reason.
	pdf := x.textFile(t, "bao-cao.pdf", []byte("%PDF-1.7\n% bao cao\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"))
	d = x.getDoc(t, pdf)
	if d.Format != "" || d.Content != "" || d.Truncated || d.Filename != "bao-cao.pdf" || d.MimeType != "application/pdf" || !strings.Contains(d.Note, "not a text file") {
		t.Fatalf("pdf = %+v", d)
	}
	// A file is found by its name, not by what its bytes say.
	if ids := x.searchIDs(t, x.p, "bao-cao.pdf"); len(ids) != 1 || ids[0] != pdf {
		t.Errorf("a file is found by its name: %v", ids)
	}
}

// What text the connector shows of a file's bytes: whole characters only, and
// nothing at all for bytes that are not UTF-8 text.
func TestMcpFileText(t *testing.T) {
	if text, cut, ok := mcpFileText([]byte("xin chào")); text != "xin chào" || cut || !ok {
		t.Errorf("plain = %q %v %v", text, cut, ok)
	}
	// One byte more than a read holds ends inside a character: the half is dropped.
	raw := append(bytes.Repeat([]byte("a"), mcpTextReadBytes-1), []byte("ế")...)
	text, cut, ok := mcpFileText(raw)
	if !ok || !cut || !utf8.ValidString(text) || strings.ContainsRune(text, utf8.RuneError) {
		t.Errorf("cut inside a character: cut=%v ok=%v valid=%v", cut, ok, utf8.ValidString(text))
	}
	for name, bad := range map[string][]byte{
		"latin-1": {'c', 'a', 'f', 0xe9}, "nul": []byte("a\x00b"), "lone lead byte": {0xe1, 0xba},
	} {
		if text, _, ok := mcpFileText(bad); ok || text != "" {
			t.Errorf("%s = %q ok=%v, want no text", name, text, ok)
		}
	}
	// A bad byte before the end of a long read is not mistaken for a cut character.
	broken := append([]byte{0xe9}, bytes.Repeat([]byte("a"), mcpTextReadBytes+10)...)
	if _, _, ok := mcpFileText(broken); ok {
		t.Error("a bad byte at the start of a long read was taken for text")
	}
}

// Reading is not writing: a page and a text file are read without an audit or
// outbox row. The service logs the read itself, as a view and a download
// (document_access_logs, not an audit row), as the screens do.
func TestMcpDocumentReadsWriteOnlyTheAccessLog(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	_, page := x.withDocs(t, "Trang để đọc", mcpTestPage)
	file := x.textFile(t, "doc.md", []byte("nội dung tệp"))
	count := func(q string, args ...any) (n int) {
		t.Helper()
		if err := x.tools.ask.pool.QueryRow(ctx, q, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	const events = `SELECT (SELECT count(*) FROM audit_events WHERE organization_id = $1) + (SELECT count(*) FROM outbox_events WHERE organization_id = $1)`
	const logs = `SELECT count(*) FROM document_access_logs WHERE organization_id = $1 AND document_id = $2 AND action = $3`
	before := count(events, x.w.OrganizationID)
	x.getDoc(t, page.Document.ID)
	x.getDoc(t, file)
	if n := count(events, x.w.OrganizationID); n != before {
		t.Fatalf("reading documents wrote %d audit/outbox rows", n-before)
	}
	if n := count(logs, x.w.OrganizationID, page.Document.ID, DocumentAccessView); n != 1 {
		t.Errorf("page: %d view rows in the access log, want 1", n)
	}
	if n := count(logs, x.w.OrganizationID, file, DocumentAccessDownload); n != 1 {
		t.Errorf("file: %d download rows in the access log, want 1", n)
	}
}

// accessLogs counts the document's rows in the access log.
func (x *mcpToolWorld) accessLogs(t *testing.T, documentID string) (n int) {
	t.Helper()
	if err := x.tools.ask.pool.QueryRow(context.Background(), `SELECT count(*) FROM document_access_logs WHERE document_id = $1`, documentID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// A call that answers "not found" for a document leaves no view of it in the
// access log, even when the person could read it: one of a sibling workspace,
// and one in the trash that the person may restore. The control is the same
// person reading it through the service, which does log; it comes last because
// the log coalesces a repeat read within five minutes.
func TestMcpRefusedDocumentReadsLeaveNoAccessLog(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	docs := x.docs(t)
	sibling, err := x.tools.ws.CreateInOrg(ctx, x.ua.ID, x.w.OrganizationID, "WS khác", "ws-khac")
	if err != nil {
		t.Fatal(err)
	}
	inSibling, err := docs.CreatePage(ctx, Human(x.ua.ID), sibling.Workspace.ID, CreatePageInput{Title: "Ở workspace khác", Content: json.RawMessage(mcpTestPage)})
	if err != nil {
		t.Fatal(err)
	}
	_, trashed := x.withDocs(t, "Trong thùng rác", mcpTestPage)
	if _, err := docs.ArchiveDocument(ctx, Human(x.ua.ID), trashed.Document.ID, ArchiveDocumentInput{}); err != nil {
		t.Fatal(err)
	}
	for name, id := range map[string]string{"sibling workspace": inSibling.Document.ID, "trash": trashed.Document.ID} {
		before := x.accessLogs(t, id)
		if _, err := x.tools.document(ctx, x.p, x.w.ID, id); !errors.Is(err, ErrNotFound) {
			t.Fatalf("%s: %v, want ErrNotFound", name, err)
		}
		if _, err := callMcpTool(t, x.tools, x.p, "get_document", `{"workspace_id":"`+x.w.ID+`","document_id":"`+id+`"}`); !errors.Is(err, ErrNotFound) {
			t.Fatalf("%s through the tool: %v, want ErrNotFound", name, err)
		}
		if after := x.accessLogs(t, id); after != before {
			t.Errorf("%s: a refused read left %d access-log rows", name, after-before)
		}
		if _, err := docs.GetDocument(ctx, Human(x.ua.ID), id); err != nil {
			t.Fatalf("control, %s read through the service: %v", name, err)
		}
		if after := x.accessLogs(t, id); after != before+1 {
			t.Errorf("control, %s: the service logged %d rows, want 1", name, after-before)
		}
	}
}

// The documents flag is the kill switch of every REST document route. The
// connector asks it for the grant's organization and the person, and answers
// documents_unavailable (search: no documents) where it is off, whatever the
// document ladder would allow.
func TestMcpDocumentsFollowTheDocumentsFlag(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	_, page := x.withDocs(t, "Kế hoạch doanh thu", mcpTestPage)
	getArgs := `{"workspace_id":"` + x.w.ID + `","document_id":"` + page.Document.ID + `"}`
	listArgs := `{"workspace_id":"` + x.w.ID + `"}`
	unavailable := func(label string) {
		t.Helper()
		for tool, args := range map[string]string{"get_document": getArgs, "list_documents": listArgs} {
			_, err := callMcpTool(t, x.tools, x.p, tool, args)
			var te McpToolError
			if !errors.As(err, &te) || te.Code != "documents_unavailable" {
				t.Errorf("%s: %s = %v, want documents_unavailable", label, tool, err)
			}
		}
		if _, err := x.tools.document(ctx, x.p, x.w.ID, page.Document.ID); !errors.Is(err, errMcpDocumentsUnavailable) {
			t.Errorf("%s: document() = %v, want documents_unavailable", label, err)
		}
		if ids := x.searchIDs(t, x.p, "doanh thu"); len(ids) != 0 {
			t.Errorf("%s: search found %v, want no documents", label, ids)
		}
	}

	// On (the registry default): everything works, and the flag was asked for
	// this person and this organization with the registry default.
	x.flags.asked = nil
	if d := x.getDoc(t, page.Document.ID); d.Title != "Kế hoạch doanh thu" {
		t.Fatalf("flag on: %+v", d)
	}
	if list, err := x.docList(t, x.p, ""); err != nil || len(list.Documents) != 1 {
		t.Fatalf("flag on: list = %+v, %v", list, err)
	}
	if ids := x.searchIDs(t, x.p, "doanh thu"); len(ids) != 1 || ids[0] != page.Document.ID {
		t.Fatalf("flag on: search = %v", ids)
	}
	if len(x.flags.asked) == 0 {
		t.Fatal("the flag was never asked")
	}
	for _, a := range x.flags.asked {
		if a.key != "documents" || a.user != x.ua.ID || a.org != x.w.OrganizationID || !a.def {
			t.Errorf("flag asked as %+v, want documents for %s in %s with the registry default on", a, x.ua.ID, x.w.OrganizationID)
		}
	}

	// Off for this organization only: another organization's setting does not matter.
	x.flags.byOrg = map[string]bool{"01OTHERORGANIZATION00000": false}
	if d := x.getDoc(t, page.Document.ID); d.Title != "Kế hoạch doanh thu" {
		t.Fatalf("flag off for another organization: %+v", d)
	}
	x.flags.byOrg = map[string]bool{x.w.OrganizationID: false}
	unavailable("flag off for the organization")

	// Back on; and a service with no evaluator wired reads as off, not as the default.
	x.flags.byOrg = map[string]bool{x.w.OrganizationID: true}
	if d := x.getDoc(t, page.Document.ID); d.Title != "Kế hoạch doanh thu" {
		t.Fatalf("flag back on: %+v", d)
	}
	x.tools.SetFlags(nil)
	unavailable("no flag evaluator")
}
