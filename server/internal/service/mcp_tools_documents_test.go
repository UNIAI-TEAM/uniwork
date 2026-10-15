package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/document"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
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
	x.files = filesfake.New(filesfake.Options{})
	docs.SetFiles(x.files)
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
		{"create_document", `{"workspace_id":"` + x.w.ID + `","title":"Mới"}`},
		{"update_document", `{"workspace_id":"` + x.w.ID + `","document_id":"01J0000000000000000000000X","revision":1,"content":"x"}`},
		{"add_document_comment", `{"workspace_id":"` + x.w.ID + `","document_id":"01J0000000000000000000000X","body":"x"}`},
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

// The document write tools (spec 2026-10-14 §5.4, Phase 4): create_document,
// update_document and add_document_comment. A page is written as Markdown, as
// the person, through DocumentService.

func (x *mcpToolWorld) docRow(t *testing.T, id string) db.Document {
	t.Helper()
	d, err := x.tools.q.GetDocumentByID(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

// docVersions is a page's history, newest first.
func (x *mcpToolWorld) docVersions(t *testing.T, id string) []db.DocumentVersion {
	t.Helper()
	page, err := x.docs(t).ListDocumentVersions(context.Background(), Human(x.ua.ID), id, ListDocumentVersionsInput{})
	if err != nil {
		t.Fatal(err)
	}
	return page.Versions
}

// count runs a count(*) query on the tools' database.
func (x *mcpToolWorld) count(t *testing.T, q string, args ...any) (n int) {
	t.Helper()
	if err := x.tools.ask.pool.QueryRow(context.Background(), q, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// docRows is how many documents the workspace holds, the trash included.
func (x *mcpToolWorld) docRows(t *testing.T) int {
	t.Helper()
	return x.count(t, `SELECT count(*) FROM documents WHERE workspace_id = $1`, x.w.ID)
}

func (x *mcpToolWorld) commentRows(t *testing.T, documentID string) int {
	t.Helper()
	return x.count(t, `SELECT count(*) FROM document_comments WHERE document_id = $1`, documentID)
}

// callCtx runs a tool as the person with the call's own context, which is how
// the /mcp handler puts the AI app on it (audit.WithVia).
func (x *mcpToolWorld) callCtx(t *testing.T, ctx context.Context, p McpPrincipal, name string, args map[string]any) (json.RawMessage, error) {
	t.Helper()
	tool, ok := McpTools(x.tools).Get(name)
	if !ok {
		t.Fatalf("no tool %q", name)
	}
	b, err := json.Marshal(args)
	if err != nil {
		t.Fatal(err)
	}
	return tool.Handle(ctx, ai.ToolContext{ActorID: p.UserID, OrganizationID: p.OrganizationID}, b)
}

// updateDoc runs update_document on the world's workspace as the world's person.
func (x *mcpToolWorld) updateDoc(t *testing.T, id string, revision int64, extra map[string]any) (json.RawMessage, error) {
	t.Helper()
	args := map[string]any{"workspace_id": x.w.ID, "document_id": id, "revision": revision}
	for k, v := range extra {
		args[k] = v
	}
	return x.callJSON(t, x.p, "update_document", args)
}

// pageMarkdown is a stored page as Markdown.
func (x *mcpToolWorld) pageMarkdown(t *testing.T, id string) string {
	t.Helper()
	md, _, err := document.PageToMarkdown(x.docRow(t, id).Content)
	if err != nil {
		t.Fatal(err)
	}
	return md
}

func toolErrorCode(err error) string {
	var te McpToolError
	if errors.As(err, &te) {
		return te.Code
	}
	return ""
}

func TestMcpCreateDocument(t *testing.T) {
	x := newMcpToolWorld(t)
	x.withDocs(t, "Có sẵn", mcpTestPage)
	content := "## Quyết định\n\n- Chốt giá\n\n[trang chính](https://example.com) và [cũ](http://example.com)\n\n![sơ đồ](https://example.com/so-do.png)\n\n[@Anh](uniwork://user/" + x.ua.ID + ")"
	raw, err := callMcpTool(t, x.tools, x.p, "create_document", `{"workspace_id":"`+x.w.ID+`","title":"  Biên bản  ","content":`+strconv.Quote(content)+`}`)
	if err != nil {
		t.Fatal(err)
	}
	res, item := writeResult(t, raw)
	id, _ := item["id"].(string)
	row := x.docRow(t, id)
	if id == "" || res.Revision != 1 || res.Revision != row.Revision || item["doc_kind"] != "page" || item["revision"] != float64(1) || item["title"] != "Biên bản" ||
		item["kind"] != "document" || item["workspace_id"] != x.w.ID || !strings.HasSuffix(item["url"].(string), "/documents/"+id) || len(res.Changes) != 0 || res.Note != "" {
		t.Fatalf("create_document = %s", raw)
	}
	onlyKeys(t, "create_document item", item, "kind", "id", "workspace_id", "title", "url", "doc_kind", "revision", "parent_id")
	if row.Kind != DocumentKindPage || row.Visibility != documentVisibilityWorkspace || row.CreatedBy != x.ua.ID || row.CreatedByKind != "human" || row.ParentID.Valid || row.Title != "Biên bản" {
		t.Errorf("stored row = %+v", row)
	}
	if n := x.count(t, `SELECT count(*) FROM audit_events WHERE resource_id = $1 AND action = 'document.created'`, id); n != 1 {
		t.Errorf("%d document.created audit rows, want 1", n)
	}
	got := x.getDoc(t, id).Content
	for _, want := range []string{"## Quyết định\n\n- Chốt giá", "[trang chính](https://example.com)", "uniwork://user/" + x.ua.ID} {
		if !strings.Contains(got, want) {
			t.Errorf("created page reads back as %q, missing %q", got, want)
		}
	}
	// Sanitize keeps https links only: the other keeps its text and loses the link.
	if strings.Contains(got, "http://example.com") || !strings.Contains(got, "cũ") {
		t.Errorf("a plain http link survived or lost its text: %q", got)
	}
	// A page that holds no asset shows no image: the image is a link.
	if strings.Contains(string(row.Content), `"image"`) || !strings.Contains(got, "(https://example.com/so-do.png)") {
		t.Errorf("an image was stored as an image, or its link was lost: %q", got)
	}

	// No content: an empty page, readable and not lossy.
	raw, err = callMcpTool(t, x.tools, x.p, "create_document", `{"workspace_id":"`+x.w.ID+`","title":"Trang trống"}`)
	if err != nil {
		t.Fatal(err)
	}
	_, item = writeResult(t, raw)
	if d := x.getDoc(t, item["id"].(string)); d.Content != "" || d.Lossy || d.Format != "markdown" {
		t.Errorf("a page created with no content = %+v", d)
	}
}

func TestMcpCreateDocumentRefusals(t *testing.T) {
	x := newMcpToolWorld(t)
	x.docs(t)
	ws := x.w.ID
	before := x.docRows(t)
	for name, c := range map[string]struct {
		args map[string]any
		want string
	}{
		"no title":         {map[string]any{"workspace_id": ws}, "title must be 1-500 characters"},
		"blank title":      {map[string]any{"workspace_id": ws, "title": "   "}, "title must be 1-500 characters"},
		"title too long":   {map[string]any{"workspace_id": ws, "title": strings.Repeat("a", 501)}, "title must be 1-500 characters"},
		"content too long": {map[string]any{"workspace_id": ws, "title": "Dài", "content": strings.Repeat("a", document.MaxMarkdownRunes+1)}, "content holds at most 50000 characters"},
		"blank parent":     {map[string]any{"workspace_id": ws, "title": "Con", "parent_id": "  "}, "parent_id must not be blank"},
		"no workspace":     {map[string]any{"title": "Mồ côi"}, "workspace_id is required"},
	} {
		_, err := x.callJSON(t, x.p, "create_document", c.args)
		var bad McpInvalidArgs
		if !errors.As(err, &bad) || !strings.Contains(bad.Msg, c.want) {
			t.Errorf("%s: %v, want invalid arguments with %q", name, err, c.want)
		}
	}
	if n := x.docRows(t); n != before {
		t.Fatalf("refused creates wrote %d documents", n-before)
	}
	// The cap is inclusive: a page of exactly that many characters is written.
	raw, err := x.callJSON(t, x.p, "create_document", map[string]any{"workspace_id": ws, "title": "Vừa đủ", "content": strings.Repeat("a", document.MaxMarkdownRunes)})
	if err != nil {
		t.Fatalf("content at the cap: %v", err)
	}
	if _, item := writeResult(t, raw); utf8.RuneCountInString(x.pageMarkdown(t, item["id"].(string))) != document.MaxMarkdownRunes {
		t.Errorf("the page at the cap was not stored whole")
	}
}

// A page goes in the workspace root, a folder or a page. It takes the
// visibility of the one it goes in (CreatePage); a parent that is not the
// person's to edit, or is not there, reads as the one not-found answer.
func TestMcpCreateDocumentUnderAParent(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	docs := x.docs(t)
	folder, err := docs.CreatePage(ctx, Human(x.ua.ID), x.w.ID, CreatePageInput{Kind: DocumentKindFolder, Title: "Thư mục"})
	if err != nil {
		t.Fatal(err)
	}
	_, page := x.withDocs(t, "Trang mẹ", mcpTestPage)
	create := func(p McpPrincipal, parent string) (map[string]any, error) {
		raw, err := x.callJSON(t, p, "create_document", map[string]any{"workspace_id": x.w.ID, "title": "Trang con", "content": "nội dung", "parent_id": parent})
		if err != nil {
			return nil, err
		}
		_, item := writeResult(t, raw)
		return item, nil
	}

	for _, parent := range []string{folder.Document.ID, page.Document.ID} {
		item, err := create(x.p, parent)
		if err != nil {
			t.Fatalf("under %s: %v", parent, err)
		}
		if row := x.docRow(t, item["id"].(string)); item["parent_id"] != parent || row.ParentID.String != parent || row.Visibility != documentVisibilityWorkspace {
			t.Errorf("under %s: item %v, row %+v", parent, item, row)
		}
	}

	// Under a restricted folder the page is restricted too: its creator reads
	// it, another member of the workspace does not.
	secret, err := docs.CreatePage(ctx, Human(x.ua.ID), x.w.ID, CreatePageInput{Kind: DocumentKindFolder, Title: "Thư mục riêng", Visibility: documentVisibilityRestricted})
	if err != nil {
		t.Fatal(err)
	}
	item, err := create(x.p, secret.Document.ID)
	if err != nil {
		t.Fatal(err)
	}
	child := item["id"].(string)
	member := x.member(t)
	if row := x.docRow(t, child); row.Visibility != documentVisibilityRestricted {
		t.Errorf("a page under a restricted folder is %s", row.Visibility)
	}
	if d := x.getDoc(t, child); d.ID != child {
		t.Errorf("the creator cannot read the page: %+v", d)
	}
	if _, err := x.tools.document(ctx, member, x.w.ID, child); !errors.Is(err, ErrNotFound) {
		t.Errorf("another member reads a page under a restricted folder: %v", err)
	}
	// The shares of a restricted folder are not copied to a page created in it.
	shared, err := docs.CreatePage(ctx, Human(x.ua.ID), x.w.ID, CreatePageInput{Kind: DocumentKindFolder, Title: "Thư mục chia sẻ", Visibility: documentVisibilityRestricted})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := docs.ShareDocument(ctx, Human(x.ua.ID), shared.Document.ID, DocumentShareInput{PrincipalType: DocumentPrincipalUser, PrincipalID: member.UserID, Level: DocumentLevelEdit}); err != nil {
		t.Fatal(err)
	}
	item, err = create(x.p, shared.Document.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := x.tools.document(ctx, member, x.w.ID, shared.Document.ID); err != nil {
		t.Fatalf("control: the member reads the folder shared with them: %v", err)
	}
	if _, err := x.tools.document(ctx, member, x.w.ID, item["id"].(string)); !errors.Is(err, ErrNotFound) {
		t.Errorf("the member reads the page under the folder that was shared with them: %v", err)
	}

	// Every parent that cannot be used reads exactly as one that does not exist.
	_, unknown := create(x.p, util.NewID())
	if !errors.Is(unknown, ErrNotFound) {
		t.Fatalf("unknown parent: %v", unknown)
	}
	sibling, err := x.tools.ws.CreateInOrg(ctx, x.ua.ID, x.w.OrganizationID, "WS khác", "ws-khac")
	if err != nil {
		t.Fatal(err)
	}
	inSibling, err := docs.CreatePage(ctx, Human(x.ua.ID), sibling.Workspace.ID, CreatePageInput{Kind: DocumentKindFolder, Title: "Ở workspace khác"})
	if err != nil {
		t.Fatal(err)
	}
	_, other := x.org(t, x.ua.ID, "Khác", "khac")
	inOther, err := docs.CreatePage(ctx, Human(x.ua.ID), other.ID, CreatePageInput{Kind: DocumentKindFolder, Title: "Ở tổ chức khác"})
	if err != nil {
		t.Fatal(err)
	}
	trashed, err := docs.CreatePage(ctx, Human(x.ua.ID), x.w.ID, CreatePageInput{Kind: DocumentKindFolder, Title: "Trong thùng rác"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := docs.ArchiveDocument(ctx, Human(x.ua.ID), trashed.Document.ID, ArchiveDocumentInput{}); err != nil {
		t.Fatal(err)
	}
	viewOnly, err := docs.CreatePage(ctx, Human(x.ua.ID), x.w.ID, CreatePageInput{Kind: DocumentKindFolder, Title: "Chỉ xem", Visibility: documentVisibilityRestricted})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := docs.ShareDocument(ctx, Human(x.ua.ID), viewOnly.Document.ID, DocumentShareInput{PrincipalType: DocumentPrincipalUser, PrincipalID: member.UserID, Level: DocumentLevelView}); err != nil {
		t.Fatal(err)
	}
	rows := x.docRows(t)
	for name, c := range map[string]struct {
		p      McpPrincipal
		parent string
	}{
		"a folder of a sibling workspace":              {x.p, inSibling.Document.ID},
		"a folder of another organization":             {x.p, inOther.Document.ID},
		"a folder in the trash":                        {x.p, trashed.Document.ID},
		"a restricted folder the person cannot read":   {member, secret.Document.ID},
		"a restricted folder the person can only read": {member, viewOnly.Document.ID},
	} {
		_, err := create(c.p, c.parent)
		if !errors.Is(err, ErrNotFound) || err.Error() != unknown.Error() {
			t.Errorf("under %s: %v, want %v", name, err, unknown)
		}
	}
	if n := x.docRows(t); n != rows {
		t.Errorf("refused creates wrote %d documents", n-rows)
	}

	// A page does not go inside a file.
	file := x.textFile(t, "ghi-chu.md", []byte("nội dung"))
	if _, err := create(x.p, file); toolErrorCode(err) != "document_parent_kind" {
		t.Errorf("under a file: %v, want document_parent_kind", err)
	}
}

func TestMcpDocumentWriteToolsFollowTheDocumentsFlag(t *testing.T) {
	x := newMcpToolWorld(t)
	_, page := x.withDocs(t, "Kế hoạch", mcpTestPage)
	x.flags.byOrg = map[string]bool{x.w.OrganizationID: false}
	rows, rev := x.docRows(t), x.docRow(t, page.Document.ID).Revision
	for tool, args := range map[string]map[string]any{
		"create_document":      {"workspace_id": x.w.ID, "title": "Mới", "content": "x"},
		"update_document":      {"workspace_id": x.w.ID, "document_id": page.Document.ID, "revision": rev, "content": "x"},
		"add_document_comment": {"workspace_id": x.w.ID, "document_id": page.Document.ID, "body": "x"},
	} {
		if _, err := x.callJSON(t, x.p, tool, args); toolErrorCode(err) != "documents_unavailable" {
			t.Errorf("%s with the flag off: %v, want documents_unavailable", tool, err)
		}
	}
	if x.docRows(t) != rows || x.docRow(t, page.Document.ID).Revision != rev || len(x.docVersions(t, page.Document.ID)) != 0 || x.commentRows(t, page.Document.ID) != 0 {
		t.Error("a tool refused for the flag wrote something")
	}
	x.flags.byOrg = map[string]bool{x.w.OrganizationID: true}
	if _, err := x.callJSON(t, x.p, "create_document", map[string]any{"workspace_id": x.w.ID, "title": "Mới"}); err != nil {
		t.Errorf("create_document with the flag back on: %v", err)
	}
}

func TestMcpUpdateDocumentAppendsWithAVersionBefore(t *testing.T) {
	x := newMcpToolWorld(t)
	docs, v := x.withDocs(t, "Kế hoạch", mcpTestPage)
	rev := v.Document.Revision
	in := map[string]any{"content": "## Rủi ro\n\nThiếu người"}
	raw, err := x.updateDoc(t, v.Document.ID, rev, in)
	if err != nil {
		t.Fatal(err)
	}
	res, item := writeResult(t, raw)
	const old = "## Mục tiêu\n\nTăng doanh thu quý bốn"
	if md := x.pageMarkdown(t, v.Document.ID); md != old+"\n\n## Rủi ro\n\nThiếu người" {
		t.Fatalf("after append: %q (%s)", md, raw)
	}
	row := x.docRow(t, v.Document.ID)
	if res.Revision <= rev || res.Revision != row.Revision || item["revision"] != float64(row.Revision) || item["id"] != v.Document.ID || item["doc_kind"] != "page" || item["title"] != "Kế hoạch" {
		t.Fatalf("update_document = %s", raw)
	}
	// Only the content changed, and an append shows what it added: from is empty,
	// to is the Markdown that was appended.
	if len(res.Changes) != 1 || res.Changes[0].Field != "content" || res.Changes[0].From != "" || res.Changes[0].To != "## Rủi ro\n\nThiếu người" {
		t.Errorf("changes = %+v", res.Changes)
	}
	// The version holds the page as it was and says who changed it.
	versions := x.docVersions(t, v.Document.ID)
	const label = "Trước khi sửa qua ứng dụng AI"
	if len(versions) != 1 || !versions[0].Label.Valid || versions[0].Label.String != label {
		t.Fatalf("versions = %+v", versions)
	}
	saved, err := docs.GetDocumentVersion(context.Background(), Human(x.ua.ID), v.Document.ID, versions[0].Version)
	if err != nil {
		t.Fatal(err)
	}
	if md, _, _ := document.PageToMarkdown(saved.Content); md != old {
		t.Errorf("the version holds %q, want the page as it was", md)
	}
	if want := "the page as it was is saved as the version " + strconv.Quote(label) + " in its history"; res.Note != want {
		t.Errorf("note = %q, want %q", res.Note, want)
	}

	// The same revision twice: nothing is written and no version is taken.
	_, err = x.updateDoc(t, v.Document.ID, rev, in)
	var te McpToolError
	if !errors.As(err, &te) || te.Code != "revision_conflict" || !strings.Contains(te.Msg, strconv.FormatInt(row.Revision, 10)) {
		t.Fatalf("a stale revision: %v", err)
	}
	if after := x.docRow(t, v.Document.ID); after.Revision != row.Revision || len(x.docVersions(t, v.Document.ID)) != 1 {
		t.Errorf("a stale revision wrote: revision %d, %d versions", after.Revision, len(x.docVersions(t, v.Document.ID)))
	}
}

// replace swaps the whole content of a page Markdown carries back exactly.
func TestMcpUpdateDocumentReplacesContent(t *testing.T) {
	x := newMcpToolWorld(t)
	_, v := x.withDocs(t, "Kế hoạch", mcpTestPage)
	raw, err := x.updateDoc(t, v.Document.ID, v.Document.Revision, map[string]any{"content": "# Kế hoạch mới\n\nBản thay thế", "mode": "replace"})
	if err != nil {
		t.Fatal(err)
	}
	res, _ := writeResult(t, raw)
	if md := x.pageMarkdown(t, v.Document.ID); md != "# Kế hoạch mới\n\nBản thay thế" {
		t.Fatalf("after replace: %q", md)
	}
	if len(res.Changes) != 1 || res.Changes[0].From != "## Mục tiêu\n\nTăng doanh thu quý bốn" || res.Changes[0].To != "# Kế hoạch mới\n\nBản thay thế" {
		t.Errorf("changes = %+v", res.Changes)
	}
	if versions := x.docVersions(t, v.Document.ID); len(versions) != 1 || !strings.Contains(res.Note, "Trước khi sửa qua ứng dụng AI") {
		t.Errorf("replace took %d versions, note %q", len(versions), res.Note)
	}
}

// replace is refused on a page Markdown cannot carry, and on one too long for
// the model to have read whole; append still works. Nothing is written.
func TestMcpUpdateDocumentReplaceRefusesLossyAndCutPages(t *testing.T) {
	x := newMcpToolWorld(t)
	lossy := `{"type":"doc","content":[{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]},{"type":"paragraph","content":[{"type":"text","text":"b"}]}]}]}]}]}`
	_, v := x.withDocs(t, "Bảng", lossy)
	_, err := x.updateDoc(t, v.Document.ID, v.Document.Revision, map[string]any{"content": "x", "mode": "replace"})
	if toolErrorCode(err) != "lossy_document" {
		t.Fatalf("replace a lossy page: %v", err)
	}
	// Title and content together are refused as a whole: the rename is not applied either.
	if _, err := x.updateDoc(t, v.Document.ID, v.Document.Revision, map[string]any{"content": "x", "mode": "replace", "title": "Mới"}); toolErrorCode(err) != "lossy_document" {
		t.Fatalf("replace and rename a lossy page: %v", err)
	}
	if row := x.docRow(t, v.Document.ID); row.Revision != v.Document.Revision || row.Title != "Bảng" || len(x.docVersions(t, v.Document.ID)) != 0 {
		t.Errorf("a refused replace wrote: %+v, %d versions", row, len(x.docVersions(t, v.Document.ID)))
	}

	page := func(chars int) DocumentView {
		t.Helper()
		content := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"` + strings.Repeat("a", chars) + `"}]}]}`
		big, err := x.docs(t).CreatePage(context.Background(), Human(x.ua.ID), x.w.ID, CreatePageInput{Title: "Dài " + strconv.Itoa(chars), Content: json.RawMessage(content)})
		if err != nil {
			t.Fatal(err)
		}
		return big
	}
	// One character over what get_document shows whole: refused. At the limit: allowed.
	over, atLimit := page(mcpMaxItemRunes+1), page(mcpMaxItemRunes)
	if d := x.getDoc(t, over.Document.ID); !d.Truncated || d.Lossy {
		t.Fatalf("the long page is cut %v, lossy %v; the case is not what it says", d.Truncated, d.Lossy)
	}
	if _, err := x.updateDoc(t, over.Document.ID, over.Document.Revision, map[string]any{"content": "x", "mode": "replace"}); toolErrorCode(err) != "lossy_document" {
		t.Fatalf("replace a page longer than one read: %v", err)
	}
	if len(x.docVersions(t, over.Document.ID)) != 0 || x.pageMarkdown(t, over.Document.ID) != strings.Repeat("a", mcpMaxItemRunes+1) {
		t.Error("a refused replace changed the long page")
	}
	if _, err := x.updateDoc(t, atLimit.Document.ID, atLimit.Document.Revision, map[string]any{"content": "x", "mode": "replace"}); err != nil {
		t.Fatalf("replace a page of exactly one read: %v", err)
	}

	// Append works on both refused pages.
	for _, d := range []DocumentView{v, over} {
		if _, err := x.updateDoc(t, d.Document.ID, d.Document.Revision, map[string]any{"content": "thêm"}); err != nil {
			t.Errorf("append to %s: %v", d.Document.Title, err)
		}
	}
}

func TestMcpUpdateDocumentRefusals(t *testing.T) {
	x := newMcpToolWorld(t)
	_, v := x.withDocs(t, "Kế hoạch", mcpTestPage)
	id, rev := v.Document.ID, v.Document.Revision
	for name, c := range map[string]struct {
		args map[string]any
		want string
	}{
		"no revision":      {map[string]any{"workspace_id": x.w.ID, "document_id": id, "content": "x"}, "revision is required"},
		"zero revision":    {map[string]any{"workspace_id": x.w.ID, "document_id": id, "revision": 0, "content": "x"}, "revision is required"},
		"unknown mode":     {map[string]any{"workspace_id": x.w.ID, "document_id": id, "revision": rev, "content": "x", "mode": "prepend"}, "mode must be append or replace"},
		"nothing to write": {map[string]any{"workspace_id": x.w.ID, "document_id": id, "revision": rev}, "send content, title or both"},
		"blank title":      {map[string]any{"workspace_id": x.w.ID, "document_id": id, "revision": rev, "title": "  "}, "title must be 1-500 characters"},
		"title too long":   {map[string]any{"workspace_id": x.w.ID, "document_id": id, "revision": rev, "title": strings.Repeat("a", 501)}, "title must be 1-500 characters"},
		"content too long": {map[string]any{"workspace_id": x.w.ID, "document_id": id, "revision": rev, "content": strings.Repeat("a", document.MaxMarkdownRunes+1)}, "content holds at most 50000 characters"},
		"replace too long": {map[string]any{"workspace_id": x.w.ID, "document_id": id, "revision": rev, "content": strings.Repeat("a", document.MaxMarkdownRunes+1), "mode": "replace"}, "content holds at most 50000 characters"},
		"empty append":     {map[string]any{"workspace_id": x.w.ID, "document_id": id, "revision": rev, "content": ""}, "nothing to append"},
		"blank append":     {map[string]any{"workspace_id": x.w.ID, "document_id": id, "revision": rev, "content": " \n\t "}, "nothing to append"},
		"no document":      {map[string]any{"workspace_id": x.w.ID, "document_id": " ", "revision": rev, "content": "x"}, "document_id is required"},
	} {
		_, err := x.callJSON(t, x.p, "update_document", c.args)
		var bad McpInvalidArgs
		if !errors.As(err, &bad) || !strings.Contains(bad.Msg, c.want) {
			t.Errorf("%s: %v, want invalid arguments with %q", name, err, c.want)
		}
	}
	if row := x.docRow(t, id); row.Revision != rev || len(x.docVersions(t, id)) != 0 {
		t.Errorf("a refused update wrote: revision %d, %d versions", row.Revision, len(x.docVersions(t, id)))
	}

	// A file and a folder are not pages.
	folder, err := x.docs(t).CreatePage(context.Background(), Human(x.ua.ID), x.w.ID, CreatePageInput{Kind: DocumentKindFolder, Title: "Thư mục"})
	if err != nil {
		t.Fatal(err)
	}
	file := x.textFile(t, "ghi-chu.md", []byte("nội dung"))
	for name, doc := range map[string]string{"file": file, "folder": folder.Document.ID} {
		_, err := x.updateDoc(t, doc, x.docRow(t, doc).Revision, map[string]any{"content": "x"})
		if toolErrorCode(err) != "not_a_page" {
			t.Errorf("update a %s: %v, want not_a_page", name, err)
		}
	}
}

// A rename needs no version: a version holds the content, and restoring one
// leaves the title alone.
func TestMcpUpdateDocumentRenames(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	_, v := x.withDocs(t, "Kế hoạch", mcpTestPage)
	raw, err := x.updateDoc(t, v.Document.ID, v.Document.Revision, map[string]any{"title": "  Kế hoạch Q4  "})
	if err != nil {
		t.Fatal(err)
	}
	res, item := writeResult(t, raw)
	if item["title"] != "Kế hoạch Q4" || res.Note != "" || len(res.Changes) != 1 || res.Changes[0] != (McpChange{"title", "Kế hoạch", "Kế hoạch Q4"}) {
		t.Fatalf("rename = %s", raw)
	}
	if row := x.docRow(t, v.Document.ID); row.Title != "Kế hoạch Q4" || row.Revision != res.Revision || x.pageMarkdown(t, v.Document.ID) != "## Mục tiêu\n\nTăng doanh thu quý bốn" || len(x.docVersions(t, v.Document.ID)) != 0 {
		t.Errorf("after rename: %+v, %d versions", row, len(x.docVersions(t, v.Document.ID)))
	}

	// Title and content in one call: one version, both changes.
	raw, err = x.updateDoc(t, v.Document.ID, res.Revision, map[string]any{"title": "Kế hoạch Q4 v2", "content": "thêm"})
	if err != nil {
		t.Fatal(err)
	}
	res, _ = writeResult(t, raw)
	if len(res.Changes) != 2 || res.Changes[0].Field != "title" || res.Changes[1].Field != "content" || len(x.docVersions(t, v.Document.ID)) != 1 {
		t.Errorf("title and content: %+v, %d versions", res.Changes, len(x.docVersions(t, v.Document.ID)))
	}

	// A title the tool could not send back is not replaced: the schema caps it
	// at 500, and a stored one longer (written outside the service) is edited in UniWork.
	long := util.NewID()
	insertRow(t, ctx, x.tools.ask.pool, "documents", baseDoc(map[string]any{
		"id": long, "organization_id": x.w.OrganizationID, "workspace_id": x.w.ID, "title": strings.Repeat("ế", 501),
		"created_by": x.ua.ID, "updated_by": x.ua.ID,
	}))
	rev := x.docRow(t, long).Revision
	if _, err := x.updateDoc(t, long, rev, map[string]any{"title": "Ngắn"}); !errors.As(err, new(McpInvalidArgs)) || !strings.Contains(err.Error(), "too long to change safely here") {
		t.Errorf("rename a title over the cap: %v", err)
	}
	if row := x.docRow(t, long); row.Title != strings.Repeat("ế", 501) || row.Revision != rev {
		t.Errorf("the refused rename wrote: revision %d", row.Revision)
	}
	// The content of that page is still the tool's to change: its title stays.
	if _, err := x.updateDoc(t, long, rev, map[string]any{"content": "thêm"}); err != nil {
		t.Errorf("append to a page with a long title: %v", err)
	}
}

// The note names the version the call took, and never one it did not: a page
// that already equals its latest version takes no new one.
func TestMcpUpdateDocumentNamesTheVersionItTook(t *testing.T) {
	x := newMcpToolWorld(t)
	docs, v := x.withDocs(t, "Kế hoạch", mcpTestPage)
	id := v.Document.ID
	if _, err := docs.CreateDocumentVersion(context.Background(), Human(x.ua.ID), id, CreateDocumentVersionInput{Label: "Bản gốc"}); err != nil {
		t.Fatal(err)
	}
	ctx := audit.WithVia(context.Background(), audit.Via{Kind: "mcp", ClientID: "c1", GrantID: "g1", ClientName: "Claude"})
	call := func(rev int64, content string) McpWriteResult {
		t.Helper()
		raw, err := x.callCtx(t, ctx, x.p, "update_document", map[string]any{"workspace_id": x.w.ID, "document_id": id, "revision": rev, "content": content})
		if err != nil {
			t.Fatal(err)
		}
		res, _ := writeResult(t, raw)
		return res
	}
	first := call(v.Document.Revision, "một")
	if want := "the page as it was is already the latest version in its history"; first.Note != want {
		t.Errorf("first note = %q, want %q", first.Note, want)
	}
	if versions := x.docVersions(t, id); len(versions) != 1 || versions[0].Label.String != "Bản gốc" {
		t.Fatalf("an unchanged page took a version: %+v", versions)
	}
	// Now the working copy differs from the latest version: the call takes one,
	// labelled with the app that made the change.
	second := call(first.Revision, "hai")
	versions := x.docVersions(t, id)
	if len(versions) != 2 || versions[0].Label.String != "Trước khi sửa qua Claude" {
		t.Fatalf("versions = %+v", versions)
	}
	if want := "the page as it was is saved as the version " + strconv.Quote("Trước khi sửa qua Claude") + " in its history"; second.Note != want {
		t.Errorf("second note = %q, want %q", second.Note, want)
	}
	saved, err := docs.GetDocumentVersion(context.Background(), Human(x.ua.ID), id, versions[0].Version)
	if err != nil {
		t.Fatal(err)
	}
	if md, _, _ := document.PageToMarkdown(saved.Content); !strings.HasSuffix(md, "một") || strings.Contains(md, "hai") {
		t.Errorf("the version holds %q, want the page before the second change", md)
	}
}

// An append shows the Markdown it added, not the start of the page: on a page
// longer than a change can show, the start of "before" and of "after" are the
// same text, which would read as nothing changed.
func TestMcpUpdateDocumentAppendShowsWhatItAddedOnALongPage(t *testing.T) {
	x := newMcpToolWorld(t)
	long := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"` + strings.Repeat("a", 3*mcpMaxHitRunes) + `"}]}]}`
	_, v := x.withDocs(t, "Dài", long)
	raw, err := x.updateDoc(t, v.Document.ID, v.Document.Revision, map[string]any{"content": "## Rủi ro\n\nThiếu người"})
	if err != nil {
		t.Fatal(err)
	}
	res, _ := writeResult(t, raw)
	if len(res.Changes) != 1 || res.Changes[0] != (McpChange{"content", "", "## Rủi ro\n\nThiếu người"}) {
		t.Errorf("changes = %+v, want the appended Markdown as to", res.Changes)
	}
}

// What the descriptions promise about links is what the converter does: only
// https, mailto: and UniWork-relative links stay links; any other keeps its
// text and loses the link.
func TestMcpDocumentLinksKeepOnlyWhatTheDescriptionSays(t *testing.T) {
	x := newMcpToolWorld(t)
	x.docs(t)
	md := "[a](https://uniwork.vn/a) [b](mailto:a@b.vn) [c](/vi/docs) [d](http://x.vn) [e](javascript:alert(1)) [f](ftp://x.vn) [g](//x.vn/p) [h](tel:123)"
	raw, err := x.callJSON(t, x.p, "create_document", map[string]any{"workspace_id": x.w.ID, "title": "Liên kết", "content": md})
	if err != nil {
		t.Fatal(err)
	}
	_, item := writeResult(t, raw)
	if got, want := x.pageMarkdown(t, item["id"].(string)), "[a](https://uniwork.vn/a) [b](mailto:a@b.vn) [c](/vi/docs) d e f g h"; got != want {
		t.Errorf("links after create = %q, want %q", got, want)
	}
	// An append goes through the same reader.
	_, v := x.withDocs(t, "Trang", mcpTestPage)
	if _, err := x.updateDoc(t, v.Document.ID, v.Document.Revision, map[string]any{"content": "[b](mailto:a@b.vn) [d](http://x.vn)"}); err != nil {
		t.Fatal(err)
	}
	if got := x.pageMarkdown(t, v.Document.ID); !strings.HasSuffix(got, "[b](mailto:a@b.vn) d") {
		t.Errorf("links after append = %q", got)
	}
}

// One failing half of search does not take the other with it: a document
// source that errors leaves the tasks and meetings already found.
func TestMcpSearchSurvivesAFailingDocumentHalf(t *testing.T) {
	x := newMcpToolWorld(t)
	task := x.task(t, x.ua.ID, x.w.ID, "Doanh thu tháng mười")
	_, v := x.withDocs(t, "Kế hoạch doanh thu", mcpTestPage)
	if ids := x.searchIDs(t, x.p, "doanh thu"); len(ids) != 2 || ids[0] != task.ID || ids[1] != v.Document.ID {
		t.Fatalf("control: search = %v, want the task and the page", ids)
	}
	// Documents run on a pool that is closed; tasks and meetings keep the open one.
	broken, err := pgxpool.NewWithConfig(context.Background(), x.tools.ask.pool.Config().Copy())
	if err != nil {
		t.Fatal(err)
	}
	broken.Close()
	x.tools.SetDocuments(NewDocumentService(broken, db.New(broken), x.tools.ask.orgs, x.tools.ws))
	if _, err := x.tools.searchDocuments(context.Background(), x.p, x.w.ID, "doanh thu"); err == nil {
		t.Fatal("the document half does not fail on a closed pool, so this test proves nothing")
	}
	if ids := x.searchIDs(t, x.p, "doanh thu"); len(ids) != 1 || ids[0] != task.ID {
		t.Errorf("search with failing documents = %v, want the task alone", ids)
	}
}

// A text file whose bytes cannot be opened is still a document: its name and
// type come back with a note, never an error.
func TestMcpGetDocumentSurvivesAnUnreadableTextFile(t *testing.T) {
	x := newMcpToolWorld(t)
	id := x.textFile(t, "ghi-chu.md", []byte("# Ghi chú"))
	if d := x.getDoc(t, id); d.Format != "text" || d.Content != "# Ghi chú" {
		t.Fatalf("control: %+v", d)
	}
	x.files.SetStorageDown(true)
	d := x.getDoc(t, id)
	if d.ID != id || d.DocKind != "file" || d.Filename != "ghi-chu.md" || d.MimeType == "" || d.Format != "" || d.Content != "" || !strings.Contains(d.Note, "could not be read") {
		t.Errorf("file with its storage down = %+v", d)
	}
	x.files.SetStorageDown(false)
	if d := x.getDoc(t, id); d.Format != "text" || d.Content != "# Ghi chú" || d.Note != "" {
		t.Errorf("file with its storage back = %+v", d)
	}
}

// The note quotes the label the version row holds, which the service trims:
// a client name that ends the label on a space is not quoted with it.
func TestMcpUpdateDocumentQuotesTheLabelThatWasStored(t *testing.T) {
	x := newMcpToolWorld(t)
	_, v := x.withDocs(t, "Kế hoạch", mcpTestPage)
	// The cut at 200 characters falls right after the space.
	name := strings.Repeat("a", maxDocumentVersionLabel-len([]rune("Trước khi sửa qua "))-1) + " b"
	ctx := audit.WithVia(context.Background(), audit.Via{Kind: "mcp", ClientID: "c1", GrantID: "g1", ClientName: name})
	raw, err := x.callCtx(t, ctx, x.p, "update_document", map[string]any{"workspace_id": x.w.ID, "document_id": v.Document.ID, "revision": v.Document.Revision, "content": "thêm"})
	if err != nil {
		t.Fatal(err)
	}
	res, _ := writeResult(t, raw)
	versions := x.docVersions(t, v.Document.ID)
	if len(versions) != 1 || !versions[0].Label.Valid || strings.HasSuffix(versions[0].Label.String, " ") || !strings.HasPrefix(versions[0].Label.String, "Trước khi sửa qua aaa") {
		t.Fatalf("the case is not what it says: versions = %+v", versions)
	}
	if want := "the page as it was is saved as the version " + strconv.Quote(versions[0].Label.String) + " in its history"; res.Note != want {
		t.Errorf("note = %q, want it to quote the stored label: %q", res.Note, want)
	}
}

// The undo each content edit names works: restoring the version it saved gives
// the page back as it was, for an append and for a replace.
func TestMcpUpdateDocumentUndoRestoresThePageAsItWas(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	docs, v := x.withDocs(t, "Kế hoạch", mcpTestPage)
	id := v.Document.ID
	const old = "## Mục tiêu\n\nTăng doanh thu quý bốn"
	rev := v.Document.Revision
	for name, args := range map[string]map[string]any{
		"append":  {"content": "## Rủi ro\n\nThiếu người"},
		"replace": {"content": "# Kế hoạch mới\n\nBản thay thế", "mode": "replace"},
	} {
		raw, err := x.updateDoc(t, id, rev, args)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if res, _ := writeResult(t, raw); x.pageMarkdown(t, id) == old || res.Note == "" {
			t.Fatalf("%s did not change the page: %s", name, raw)
		}
		var saved int32 // the newest version an AI edit saved
		for _, ver := range x.docVersions(t, id) {
			if strings.HasPrefix(ver.Label.String, "Trước khi sửa qua") {
				saved = ver.Version
				break
			}
		}
		if saved == 0 {
			t.Fatalf("%s saved no version: %+v", name, x.docVersions(t, id))
		}
		if _, err := docs.RestoreDocumentVersion(ctx, Human(x.ua.ID), id, RestoreDocumentVersionInput{Version: saved}); err != nil {
			t.Fatalf("%s: restore version %d: %v", name, saved, err)
		}
		if md := x.pageMarkdown(t, id); md != old {
			t.Errorf("after undoing the %s the page holds %q, want %q", name, md, old)
		}
		rev = x.docRow(t, id).Revision
	}
}

// A refusal of the document tree reaches the model in English and names no
// row: the service's own Vietnamese text is for its screens.
func TestMcpMapErrorGivesDocumentTreeRefusalsInEnglish(t *testing.T) {
	for code, err := range map[string]error{"document_parent_kind": errDocumentParentKind(), "document_too_deep": errDocumentTooDeep()} {
		var te McpToolError
		got := mcpMapError(err)
		if !errors.As(got, &te) || te.Code != code || te.Msg == "" || te.Msg == mcpToolMessages["conflict"] {
			t.Fatalf("%s → %#v", code, got)
		}
		for _, r := range te.Msg {
			if r > unicode.MaxASCII {
				t.Errorf("%s message %q is not plain English", code, te.Msg)
				break
			}
		}
	}
	if msg := mcpToolMessages["document_parent_kind"]; !strings.Contains(msg, "file") || !strings.Contains(msg, "folder") {
		t.Errorf("document_parent_kind = %q, want it to say a page goes in a folder or a page, not a file", msg)
	}
	if msg := mcpToolMessages["document_too_deep"]; !strings.Contains(msg, "5") {
		t.Errorf("document_too_deep = %q, want the depth", msg)
	}
}

// A call that would change nothing writes nothing: no revision, no version.
func TestMcpUpdateDocumentThatChangesNothing(t *testing.T) {
	x := newMcpToolWorld(t)
	_, v := x.withDocs(t, "Kế hoạch", mcpTestPage)
	raw, err := x.updateDoc(t, v.Document.ID, v.Document.Revision, map[string]any{"title": "Kế hoạch", "content": "## Mục tiêu\n\nTăng doanh thu quý bốn", "mode": "replace"})
	if err != nil {
		t.Fatal(err)
	}
	res, _ := writeResult(t, raw)
	if res.Revision != v.Document.Revision || len(res.Changes) != 0 || !strings.Contains(res.Note, "nothing changed") {
		t.Errorf("no-op update = %s", raw)
	}
	if row := x.docRow(t, v.Document.ID); row.Revision != v.Document.Revision || len(x.docVersions(t, v.Document.ID)) != 0 {
		t.Errorf("a no-op update wrote: revision %d, %d versions", row.Revision, len(x.docVersions(t, v.Document.ID)))
	}
}

// What the result says after the page is saved never fails the call: a model
// that read an error would write it again.
func TestMcpDocumentUpdatedResultSurvivesAnUnreadablePage(t *testing.T) {
	s := &McpToolService{frontend: "https://app.example.test"}
	before := db.Document{ID: "d1", WorkspaceID: "w1", Kind: DocumentKindPage, Title: "Cũ", Revision: 2}
	after := before
	after.Title, after.Revision, after.Content = "Mới", 3, []byte(`{`)
	res := s.documentUpdated("/o/w", before, after, &mcpContentEdit{replace: true, beforeMD: "trước"}, "the page as it was is saved")
	if res.Revision != 3 || res.Item == nil || !strings.Contains(res.Note, "the page as it was is saved") || !strings.Contains(res.Note, "could not be read back") {
		t.Errorf("result = %+v", res)
	}
	if len(res.Changes) != 1 || res.Changes[0].Field != "title" {
		t.Errorf("changes = %+v, want the title alone", res.Changes)
	}
}

// Documents keep their own ladder: a person who may only read a page cannot
// write it, and the answer is the one a page that is not there gets.
func TestMcpDocumentWritesNeedTheRightToEdit(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	docs := x.docs(t)
	member := x.member(t)
	restricted := func(title string, level DocumentLevel) DocumentView {
		t.Helper()
		v, err := docs.CreatePage(ctx, Human(x.ua.ID), x.w.ID, CreatePageInput{Title: title, Visibility: documentVisibilityRestricted, Content: json.RawMessage(mcpTestPage)})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := docs.ShareDocument(ctx, Human(x.ua.ID), v.Document.ID, DocumentShareInput{PrincipalType: DocumentPrincipalUser, PrincipalID: member.UserID, Level: level}); err != nil {
			t.Fatal(err)
		}
		return v
	}
	viewOnly, editable := restricted("Chỉ xem", DocumentLevelView), restricted("Được sửa", DocumentLevelEdit)
	_, unknown := x.tools.document(ctx, member, x.w.ID, util.NewID())

	for tool, args := range map[string]map[string]any{
		"update_document":      {"workspace_id": x.w.ID, "document_id": viewOnly.Document.ID, "revision": viewOnly.Document.Revision, "content": "x"},
		"add_document_comment": {"workspace_id": x.w.ID, "document_id": viewOnly.Document.ID, "body": "x"},
	} {
		if _, err := x.callJSON(t, member, tool, args); !errors.Is(err, ErrNotFound) || err.Error() != unknown.Error() {
			t.Errorf("%s on a page the person may only read: %v, want %v", tool, err, unknown)
		}
	}
	if x.docRow(t, viewOnly.Document.ID).Revision != viewOnly.Document.Revision || len(x.docVersions(t, viewOnly.Document.ID)) != 0 || x.commentRows(t, viewOnly.Document.ID) != 0 {
		t.Error("a refused write left something behind")
	}

	// With the right to edit, both go through, as that person.
	raw, err := x.callJSON(t, member, "update_document", map[string]any{"workspace_id": x.w.ID, "document_id": editable.Document.ID, "revision": editable.Document.Revision, "content": "do thành viên"})
	if err != nil {
		t.Fatal(err)
	}
	if row := x.docRow(t, editable.Document.ID); row.UpdatedBy != member.UserID || row.UpdatedByKind != "human" {
		t.Errorf("updated by %s/%s: %s", row.UpdatedBy, row.UpdatedByKind, raw)
	}
	if _, err := x.callJSON(t, member, "add_document_comment", map[string]any{"workspace_id": x.w.ID, "document_id": editable.Document.ID, "body": "do thành viên"}); err != nil {
		t.Errorf("comment by a person who may edit: %v", err)
	}
	if versions := x.docVersions(t, editable.Document.ID); len(versions) != 1 || versions[0].CreatedBy != member.UserID {
		t.Errorf("the version was taken as %+v, want the member", versions)
	}
}

func TestMcpAddDocumentComment(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	docs, v := x.withDocs(t, "Kế hoạch", mcpTestPage)
	member := x.member(t)
	body := "Cần số liệu tháng 9, nhờ [@Bình](mention://member/" + member.UserID + ") xem"
	raw, err := callMcpTool(t, x.tools, x.p, "add_document_comment", `{"workspace_id":"`+x.w.ID+`","document_id":"`+v.Document.ID+`","body":`+strconv.Quote("  "+body+"  ")+`}`)
	if err != nil {
		t.Fatal(err)
	}
	res, item := writeResult(t, raw)
	id, _ := item["id"].(string)
	if _, hasTask := item["task_id"]; id == "" || item["document_id"] != v.Document.ID || hasTask || item["body"] != body ||
		item["url"] != "https://app.example.test/"+x.tools.mustBase(t, x.w.ID)+"/documents/"+v.Document.ID || res.Revision != 0 || len(res.Changes) != 0 || res.Note != "" {
		t.Fatalf("add_document_comment = %s", raw)
	}
	onlyKeys(t, "add_document_comment item", item, "id", "document_id", "body", "url")

	var author, kind, stored string
	var parent *string
	if err := x.tools.ask.pool.QueryRow(ctx, `SELECT author_id, author_kind, body, parent_comment_id FROM document_comments WHERE id = $1`, id).Scan(&author, &kind, &stored, &parent); err != nil {
		t.Fatal(err)
	}
	if author != x.ua.ID || kind != "human" || stored != body || parent != nil {
		t.Errorf("stored comment = %s/%s %q parent %v", author, kind, stored, parent)
	}
	// The mention token is read as the editor's own: the member is on it, active.
	var state string
	if err := x.tools.ask.pool.QueryRow(ctx, `SELECT state FROM document_comment_mentions WHERE comment_id = $1 AND user_id = $2`, id, member.UserID).Scan(&state); err != nil || state != "active" {
		t.Errorf("mention row of the member = %q, %v", state, err)
	}
	if n := x.count(t, `SELECT count(*) FROM audit_events WHERE resource_id = $1 AND action = 'document.comment_added' AND metadata::jsonb->>'comment_id' = $2`, v.Document.ID, id); n != 1 {
		t.Errorf("%d document.comment_added audit rows, want 1", n)
	}
	// Everyone who can read the document reads the comment.
	if c, err := docs.GetDocumentComment(ctx, Human(member.UserID), id); err != nil || c.Body != body {
		t.Errorf("the member reads %+v, %v", c, err)
	}

	// The tool starts a thread: it cannot reply, so it takes no parent.
	for _, field := range []string{"reply_to", "parent_id"} {
		_, err := x.callJSON(t, x.p, "add_document_comment", map[string]any{"workspace_id": x.w.ID, "document_id": v.Document.ID, "body": "x", field: id})
		if !errors.As(err, new(McpInvalidArgs)) || !strings.Contains(err.Error(), "unknown field "+field) {
			t.Errorf("add_document_comment with %s: %v", field, err)
		}
	}
	// A long body is cut in the answer, not in the store.
	long := strings.Repeat("dài ", 600)
	raw, err = callMcpTool(t, x.tools, x.p, "add_document_comment", `{"workspace_id":"`+x.w.ID+`","document_id":"`+v.Document.ID+`","body":`+strconv.Quote(long)+`}`)
	if err != nil {
		t.Fatal(err)
	}
	_, item = writeResult(t, raw)
	if got := item["body"].(string); utf8.RuneCountInString(got) > mcpMaxHitRunes || !strings.HasSuffix(got, mcpHitCut) {
		t.Errorf("answer body holds %d characters", utf8.RuneCountInString(got))
	}
	var full string
	if err := x.tools.ask.pool.QueryRow(ctx, `SELECT body FROM document_comments WHERE id = $1`, item["id"]).Scan(&full); err != nil || full != strings.TrimSpace(long) {
		t.Errorf("the stored comment is %d characters, %v", utf8.RuneCountInString(full), err)
	}
}

func TestMcpAddDocumentCommentRefusals(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	docs, v := x.withDocs(t, "Kế hoạch", mcpTestPage)
	for name, body := range map[string]string{"empty": "", "blank": " \n ", "too long": strings.Repeat("a", mcpMaxBodyRunes+1)} {
		_, err := x.callJSON(t, x.p, "add_document_comment", map[string]any{"workspace_id": x.w.ID, "document_id": v.Document.ID, "body": body})
		if !errors.As(err, new(McpInvalidArgs)) || !strings.Contains(err.Error(), "body must be 1-20000 characters") {
			t.Errorf("%s body: %v", name, err)
		}
	}
	if _, err := x.callJSON(t, x.p, "add_document_comment", map[string]any{"workspace_id": x.w.ID, "document_id": " ", "body": "x"}); !errors.As(err, new(McpInvalidArgs)) {
		t.Errorf("blank document_id: %v", err)
	}
	// A document that is not here for the workspace is not found, and nothing is written.
	_, unknown := x.callJSON(t, x.p, "add_document_comment", map[string]any{"workspace_id": x.w.ID, "document_id": util.NewID(), "body": "x"})
	sibling, err := x.tools.ws.CreateInOrg(ctx, x.ua.ID, x.w.OrganizationID, "WS khác", "ws-khac")
	if err != nil {
		t.Fatal(err)
	}
	inSibling, err := docs.CreatePage(ctx, Human(x.ua.ID), sibling.Workspace.ID, CreatePageInput{Title: "Ở workspace khác", Content: json.RawMessage(mcpTestPage)})
	if err != nil {
		t.Fatal(err)
	}
	trashed, err := docs.CreatePage(ctx, Human(x.ua.ID), x.w.ID, CreatePageInput{Title: "Trong thùng rác", Content: json.RawMessage(mcpTestPage)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := docs.ArchiveDocument(ctx, Human(x.ua.ID), trashed.Document.ID, ArchiveDocumentInput{}); err != nil {
		t.Fatal(err)
	}
	for name, id := range map[string]string{"sibling workspace": inSibling.Document.ID, "trash": trashed.Document.ID} {
		if _, err := x.callJSON(t, x.p, "add_document_comment", map[string]any{"workspace_id": x.w.ID, "document_id": id, "body": "x"}); !errors.Is(err, ErrNotFound) || err.Error() != unknown.Error() {
			t.Errorf("%s: %v, want %v", name, err, unknown)
		}
		if n := x.commentRows(t, id); n != 0 {
			t.Errorf("%s: %d comments written", name, n)
		}
	}
	if n := x.commentRows(t, v.Document.ID); n != 0 {
		t.Errorf("refused calls wrote %d comments", n)
	}
}

// What the three tools record as the person goes through the AI app that
// asked: the audit rows of the page, its version and the comment name it.
func TestMcpDocumentWriteToolsRecordTheViaOnTheirAuditRows(t *testing.T) {
	x := newMcpToolWorld(t)
	x.docs(t)
	via := audit.Via{Kind: "mcp", ClientID: "c1", GrantID: "g1", ClientName: "Claude"}
	ctx := audit.WithVia(context.Background(), via)
	call := func(name string, args map[string]any) map[string]any {
		t.Helper()
		raw, err := x.callCtx(t, ctx, x.p, name, args)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		_, item := writeResult(t, raw)
		return item
	}
	page := call("create_document", map[string]any{"workspace_id": x.w.ID, "title": "Trang qua ứng dụng AI", "content": "một"})
	id := page["id"].(string)
	call("update_document", map[string]any{"workspace_id": x.w.ID, "document_id": id, "revision": page["revision"], "content": "hai"})
	comment := call("add_document_comment", map[string]any{"workspace_id": x.w.ID, "document_id": id, "body": "Bình luận qua ứng dụng AI"})
	for _, row := range []struct{ what, where, id string }{
		{"document.created", `resource_id = $1 AND action = 'document.created'`, id},
		{"document.version_created", `resource_id = $1 AND action = 'document.version_created'`, id},
		{"document.updated", `resource_id = $1 AND action = 'document.updated'`, id},
		{"comment", `metadata::jsonb->>'comment_id' = $1`, comment["id"].(string)},
	} {
		var kind, client, grant, name string
		q := `SELECT coalesce(metadata::jsonb->'via'->>'kind',''), coalesce(metadata::jsonb->'via'->>'client_id',''), coalesce(metadata::jsonb->'via'->>'grant_id',''), coalesce(metadata::jsonb->'via'->>'client_name','') FROM audit_events WHERE ` + row.where
		if err := x.tools.ask.pool.QueryRow(context.Background(), q, row.id).Scan(&kind, &client, &grant, &name); err != nil {
			t.Fatalf("%s audit row: %v", row.what, err)
		}
		if (audit.Via{Kind: kind, ClientID: client, GrantID: grant, ClientName: name}) != via {
			t.Errorf("%s audit via = %q/%q/%q/%q, want %+v", row.what, kind, client, grant, name, via)
		}
	}
}

// The limits the tools state to the model are the ones they hold.
func TestMcpDocumentWriteSchemasHoldTheLimits(t *testing.T) {
	registry := McpTools(&McpToolService{})
	prop := func(tool, field, key string) any {
		t.Helper()
		def, _ := registry.Get(tool)
		var schema struct {
			Properties map[string]map[string]any `json:"properties"`
		}
		if err := json.Unmarshal(def.Schema, &schema); err != nil {
			t.Fatal(err)
		}
		return schema.Properties[field][key]
	}
	for _, c := range []struct {
		tool, field, key string
		want             float64
	}{
		{"create_document", "title", "maxLength", 500}, {"create_document", "content", "maxLength", document.MaxMarkdownRunes},
		{"update_document", "title", "maxLength", 500}, {"update_document", "content", "maxLength", document.MaxMarkdownRunes},
		{"add_document_comment", "body", "maxLength", mcpMaxBodyRunes},
	} {
		if got := prop(c.tool, c.field, c.key); got != c.want {
			t.Errorf("%s.%s %s = %v, want %v", c.tool, c.field, c.key, got, c.want)
		}
	}
	if got, _ := json.Marshal(prop("update_document", "mode", "enum")); string(got) != `["append","replace"]` {
		t.Errorf("update_document mode enum = %s", got)
	}
}
