package service

import (
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/attachtext"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// indexRequests lists the version ids that document.text_index_requested was
// written for, for one document, oldest first.
func indexRequests(t *testing.T, env *docStorageEnv, docID string) []string {
	t.Helper()
	var out []string
	for _, p := range outboxPayloads(t, env.f.pool, topicDocumentTextIndexRequested) {
		if p["document_id"] == docID {
			if p["organization_id"] == "" || p["workspace_id"] == "" {
				t.Fatalf("payload misses a tenant id: %v", p)
			}
			out = append(out, p["version_id"])
		}
	}
	return out
}

func TestFileVersionsRequestTheirTextIndex(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	created := env.createFile(t, member, "chi-muc.pdf", pdfBody("v1"))
	first := created.Document.FileVersionID.String
	if got := indexRequests(t, env, created.Document.ID); len(got) != 1 || got[0] != first {
		t.Fatalf("create requests = %v, want [%s]", got, first)
	}

	up := env.upload(t, member, created.Document.ID, "chi-muc-v2.pdf", pdfBody("v2"))
	next, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
	mustf(t, err, "commit")
	if got := indexRequests(t, env, created.Document.ID); len(got) != 2 || got[1] != next.Version.ID {
		t.Fatalf("commit requests = %v, want the new version %s second", got, next.Version.ID)
	}

	cp, err := env.svc.CopyDocument(ctx, member, created.Document.ID, CopyDocumentInput{Consent: "copy", IdempotencyKey: util.NewID()})
	mustf(t, err, "copy")
	if got := indexRequests(t, env, cp.Document.ID); len(got) != 1 || got[0] != cp.Version.ID {
		t.Fatalf("copy requests = %v, want [%s]", got, cp.Version.ID)
	}

	rest, err := env.svc.RestoreDocumentVersion(ctx, member, created.Document.ID, RestoreDocumentVersionInput{
		Version: 1, BaseRevision: next.Document.Revision, IdempotencyKey: util.NewID(),
	})
	mustf(t, err, "restore")
	if got := indexRequests(t, env, created.Document.ID); len(got) != 3 || got[2] != rest.Version.ID {
		t.Fatalf("restore requests = %v, want the restored version %s third", got, rest.Version.ID)
	}
}

func TestNewFileVersionClearsTheIndexedText(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	created := env.createFile(t, member, "cu.pdf", pdfBody("v1"))
	_, err := env.f.pool.Exec(ctx,
		`UPDATE documents SET content_text = 'chữ cũ', search_text = search_text || ' chữ cũ' WHERE id = $1`, created.Document.ID)
	mustf(t, err, "seed text")

	up := env.upload(t, member, created.Document.ID, "cu-v2.pdf", pdfBody("v2"))
	_, err = env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
	mustf(t, err, "commit")

	var title, content, search string
	mustf(t, env.f.pool.QueryRow(ctx,
		`SELECT title, content_text, search_text FROM documents WHERE id = $1`, created.Document.ID).Scan(&title, &content, &search), "read")
	if content != "" || search != documentSearchText(title, "") {
		t.Fatalf("content_text = %q, search_text = %q, want empty and %q", content, search, documentSearchText(title, ""))
	}
}

const (
	textIndexPhrase = "Điều khoản bảo hành 24 tháng"
	textIndexQuery  = "bao hanh 24 thang"
	textIndexW      = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`
	textIndexA      = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`
)

// textIndexRow is the columns the indexer writes, plus the ones it must not touch.
type textIndexRow struct {
	Title, Content, Search    string
	Revision, ContentRevision int64
	UpdatedAt                 time.Time
}

func readTextIndexRow(t *testing.T, pool *pgxpool.Pool, id string) textIndexRow {
	t.Helper()
	var r textIndexRow
	mustf(t, pool.QueryRow(context.Background(),
		`SELECT title, content_text, search_text, revision, content_revision, updated_at FROM documents WHERE id = $1`, id).
		Scan(&r.Title, &r.Content, &r.Search, &r.Revision, &r.ContentRevision, &r.UpdatedAt), "read row")
	return r
}

// textIndexDocx puts the phrase in the 12th paragraph, after more than 300 characters.
func textIndexDocx(t *testing.T) []byte {
	var b strings.Builder
	b.WriteString(`<w:document ` + textIndexW + `><w:body>`)
	for i := 1; i <= 11; i++ {
		b.WriteString(`<w:p><w:r><w:t>` + strings.Repeat("Đoạn mở đầu số một. ", 3) + `</w:t></w:r></w:p>`)
	}
	b.WriteString(`<w:p><w:r><w:t>` + textIndexPhrase + `</w:t></w:r></w:p></w:body></w:document>`)
	return officeFile(t, map[string]string{"word/document.xml": b.String()})
}

func TestTextIndexMakesOfficeFilesSearchable(t *testing.T) {
	x := newMcpToolWorld(t)
	idx := NewDocumentTextIndexer(x.docs(t), x.tools.ask, nil)
	ctx := context.Background()

	slide := func(s string) string {
		return `<p:sld ` + textIndexA + `><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>` + s + `</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
	}
	xlsx := map[string]string{}
	for k, v := range officeXLSXParts {
		xlsx[k] = v
	}
	xlsx["xl/worksheets/sheet1.xml"] = `<worksheet><sheetData><row r="7"><c r="B7" t="inlineStr"><is><t>` + textIndexPhrase + `</t></is></c></row></sheetData></worksheet>`

	for name, body := range map[string][]byte{
		"hop-dong.docx": textIndexDocx(t),
		"bang.xlsx":     officeFile(t, xlsx),
		"gioi-thieu.pptx": officeFile(t, map[string]string{
			"ppt/presentation.xml":  `<p:presentation/>`,
			"ppt/slides/slide1.xml": slide("Mở đầu"), "ppt/slides/slide2.xml": slide("Giữa"),
			"ppt/slides/slide3.xml": slide(textIndexPhrase),
		}),
	} {
		id := x.textFile(t, name, body)
		if ids := x.searchIDs(t, x.p, textIndexQuery); containsID(ids, id) {
			t.Fatalf("%s found before it was indexed", name)
		}
		doc, err := x.docs(t).q.GetDocumentByID(ctx, id)
		mustf(t, err, "get")
		mustf(t, idx.Index(ctx, doc.OrganizationID, id, doc.FileVersionID.String), "index %s", name)
		row := readTextIndexRow(t, x.tools.ask.pool, id)
		if !strings.Contains(row.Content, textIndexPhrase) {
			t.Fatalf("%s content_text = %q", name, row.Content)
		}
		if ids := x.searchIDs(t, x.p, textIndexQuery); !containsID(ids, id) {
			t.Fatalf("%s not found after indexing: %v", name, ids)
		}
	}
}

func TestTextIndexSurvivesRenameAndMove(t *testing.T) {
	x := newMcpToolWorld(t)
	docs := x.docs(t)
	idx := NewDocumentTextIndexer(docs, x.tools.ask, nil)
	ctx := context.Background()
	id := x.textFile(t, "hd.docx", textIndexDocx(t))
	doc, err := docs.q.GetDocumentByID(ctx, id)
	mustf(t, err, "get")
	mustf(t, idx.Index(ctx, doc.OrganizationID, id, doc.FileVersionID.String), "index")

	title := "Tên mới của hợp đồng"
	v, err := docs.UpdateDocument(ctx, Human(x.ua.ID), id, UpdateDocumentInput{Revision: doc.Revision, Title: &title})
	mustf(t, err, "rename")
	folder, err := docs.CreatePage(ctx, Human(x.ua.ID), x.w.ID, CreatePageInput{Kind: DocumentKindFolder, Title: "Thư mục", Visibility: documentVisibilityWorkspace})
	mustf(t, err, "folder")
	_, err = docs.MoveDocument(ctx, Human(x.ua.ID), id, MoveDocumentInput{ParentID: folder.Document.ID, Revision: v.Document.Revision, IdempotencyKey: util.NewID()})
	mustf(t, err, "move")
	if ids := x.searchIDs(t, x.p, textIndexQuery); !containsID(ids, id) {
		t.Fatalf("not found after rename and move: %v", ids)
	}
}

func TestTextIndexWritesNoBusinessChange(t *testing.T) {
	x := newMcpToolWorld(t)
	idx := NewDocumentTextIndexer(x.docs(t), x.tools.ask, nil)
	ctx := context.Background()
	pool := x.tools.ask.pool
	id := x.textFile(t, "hd.docx", textIndexDocx(t))
	doc, err := x.docs(t).q.GetDocumentByID(ctx, id)
	mustf(t, err, "get")
	count := func(q string) (n int) {
		mustf(t, pool.QueryRow(ctx, q, id).Scan(&n), "count")
		return n
	}
	const audits, logs = `SELECT count(*) FROM audit_events WHERE resource_id = $1`, `SELECT count(*) FROM document_access_logs WHERE document_id = $1`
	auditBefore, logsBefore, before := count(audits), count(logs), readTextIndexRow(t, pool, id)

	mustf(t, idx.Index(ctx, doc.OrganizationID, id, doc.FileVersionID.String), "index")

	after := readTextIndexRow(t, pool, id)
	if after.Revision != before.Revision || after.ContentRevision != before.ContentRevision || !after.UpdatedAt.Equal(before.UpdatedAt) {
		t.Fatalf("business columns moved: before %+v after %+v", before, after)
	}
	if a, l := count(audits), count(logs); a != auditBefore || l != logsBefore {
		t.Fatalf("audit %d->%d, access logs %d->%d", auditBefore, a, logsBefore, l)
	}
}

func TestTextIndexIgnoresAStaleVersion(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	member := human(env.tn.member)
	idx := NewDocumentTextIndexer(env.svc, nil, nil)
	created := env.createFile(t, member, "cu.docx", textIndexDocx(t))
	first := created.Document.FileVersionID.String
	up := env.upload(t, member, created.Document.ID, "cu-v2.docx", officeFile(t, map[string]string{"word/document.xml": "<w:document ></w:document>"}))
	_, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
	mustf(t, err, "commit")
	before := readTextIndexRow(t, env.f.pool, created.Document.ID)

	mustf(t, idx.Index(context.Background(), env.tn.orgID, created.Document.ID, first), "stale index")
	if after := readTextIndexRow(t, env.f.pool, created.Document.ID); after != before {
		t.Fatalf("a stale version wrote: before %+v after %+v", before, after)
	}
}

func TestTextIndexClearsWhatItCannotRead(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	member := human(env.tn.member)
	idx := NewDocumentTextIndexer(env.svc, nil, nil)
	ctx := context.Background()
	broken := officeFile(t, map[string]string{"word/document.xml": `<w:document ` + textIndexW + `><w:body><w:p>`})
	for name, body := range map[string][]byte{
		"b.html": []byte("<p>Điều khoản</p>"), "c.docx": broken, "d.docx": textIndexDocx(t),
	} {
		res := env.createFile(t, member, name, body)
		id := res.Document.ID
		_, err := env.f.pool.Exec(ctx, `UPDATE documents SET content_text = 'cũ' WHERE id = $1`, id)
		mustf(t, err, "seed")
		if name == "d.docx" { // over the read ceiling: decided by the recorded size, the file is never opened
			_, err = env.f.pool.Exec(ctx, `UPDATE document_versions SET size_bytes = $2 WHERE id = $1`, res.Document.FileVersionID.String, int64(mcpOfficeReadBytes+1))
			mustf(t, err, "size")
		}
		mustf(t, idx.Index(ctx, env.tn.orgID, id, res.Document.FileVersionID.String), "index %s", name)
		row := readTextIndexRow(t, env.f.pool, id)
		if row.Content != "" || row.Search != documentSearchText(row.Title, "") {
			t.Fatalf("%s: content %q, search %q", name, row.Content, row.Search)
		}
	}
}

func TestTextIndexMakesPDFsSearchable(t *testing.T) {
	x := newMcpToolWorld(t)
	fake := &fakePDFText{text: "Mở đầu\fĐiều khoản bảo hành 24 tháng"}
	idx := NewDocumentTextIndexer(x.docs(t), x.tools.ask, fake)
	ctx := context.Background()
	id := x.textFile(t, "hop-dong.pdf", []byte(testPDFBytes))
	if ids := x.searchIDs(t, x.p, "bao hanh 24 thang"); containsID(ids, id) {
		t.Fatal("found before it was indexed")
	}
	doc, err := x.docs(t).q.GetDocumentByID(ctx, id)
	mustf(t, err, "get")
	mustf(t, idx.Index(ctx, doc.OrganizationID, id, doc.FileVersionID.String), "index")
	row := readTextIndexRow(t, x.tools.ask.pool, id)
	if !strings.Contains(row.Content, "Điều khoản bảo hành 24 tháng") || strings.Contains(row.Content, "[page") {
		t.Fatalf("content_text = %q", row.Content)
	}
	if ids := x.searchIDs(t, x.p, "bao hanh 24 thang"); !containsID(ids, id) {
		t.Fatalf("not found after indexing: %v", ids)
	}
	if len(fake.calls) != 1 {
		t.Fatalf("engine calls = %d", len(fake.calls))
	}
	if c := fake.calls[0]; c.Format != office.ExtractFormatPDF || c.ActorKind != "system" || c.ActorID != "document_text_index" ||
		c.DocumentID != id || c.DriveFileID != "" || c.OrganizationID != doc.OrganizationID || c.WorkspaceID != doc.WorkspaceID {
		t.Fatalf("request = %+v", c)
	}
}

func TestTextIndexDoesNotRetryWithoutTheEngine(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	for name, c := range map[string]struct {
		fake     *fakePDFText
		noEngine bool
	}{
		"unavailable": {fake: &fakePDFText{err: office.ErrExtractUnavailable}},
		"unreadable":  {fake: &fakePDFText{err: &office.ExtractUnreadableError{}}},
		"no-engine":   {fake: &fakePDFText{text: "x"}, noEngine: true},
	} {
		var pdf DriveOfficeExtractor = c.fake
		if c.noEngine {
			pdf = nil
		}
		idx := NewDocumentTextIndexer(env.svc, nil, pdf)
		res := env.createFile(t, human(env.tn.member), name+".pdf", pdfBody(name))
		id := res.Document.ID
		_, err := env.f.pool.Exec(ctx, `UPDATE documents SET content_text = 'cũ' WHERE id = $1`, id)
		mustf(t, err, "seed")
		mustf(t, idx.Index(ctx, env.tn.orgID, id, res.Document.FileVersionID.String), "index %s", name)
		if row := readTextIndexRow(t, env.f.pool, id); row.Content != "" {
			t.Fatalf("%s: content_text = %q", name, row.Content)
		}
		if c.noEngine && len(c.fake.calls) != 0 {
			t.Fatalf("%s: engine was called", name)
		}
	}
}

func TestTextIndexWaitsForTheFileReadSlot(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	idx := NewDocumentTextIndexer(env.svc, nil, nil)
	res := env.createFile(t, human(env.tn.member), "hd.docx", textIndexDocx(t))
	before := readTextIndexRow(t, env.f.pool, res.Document.ID)
	idx.reads <- struct{}{}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if err := idx.Index(ctx, env.tn.orgID, res.Document.ID, res.Document.FileVersionID.String); err == nil {
		t.Fatal("Index returned nil while the read slot was held")
	}
	<-idx.reads
	if after := readTextIndexRow(t, env.f.pool, res.Document.ID); after != before {
		t.Fatalf("wrote without the slot: %+v", after)
	}
}

func TestTextIndexIgnoresOtherTenantsAndPages(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	member := human(env.tn.member)
	idx := NewDocumentTextIndexer(env.svc, nil, nil)
	ctx := context.Background()
	res := env.createFile(t, member, "hd.docx", textIndexDocx(t))
	page, err := env.svc.CreatePage(ctx, member, env.tn.wsA, CreatePageInput{Title: "Trang"})
	mustf(t, err, "page")
	before := readTextIndexRow(t, env.f.pool, res.Document.ID)
	ver := res.Document.FileVersionID.String

	for name, call := range map[string]func() error{
		"wrong org":  func() error { return idx.Index(ctx, util.NewID(), res.Document.ID, ver) },
		"page":       func() error { return idx.Index(ctx, env.tn.orgID, page.Document.ID, ver) },
		"unknown id": func() error { return idx.Index(ctx, env.tn.orgID, util.NewID(), ver) },
	} {
		if err := call(); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if after := readTextIndexRow(t, env.f.pool, res.Document.ID); after != before {
		t.Fatalf("a foreign call wrote: %+v", after)
	}
	if p := readTextIndexRow(t, env.f.pool, page.Document.ID); p.Content != "" {
		t.Fatalf("page content_text = %q", p.Content)
	}
}

func TestTextIndexMIMEAndText(t *testing.T) {
	docx := officeByExt[".docx"]
	for _, c := range []struct {
		mime, name, want string
		ok               bool
	}{
		{"application/zip", "a.docx", docx, true},
		{"", "a.md", "text/markdown", true}, {"", "a.markdown", "text/markdown", true},
		{"text/plain", "a.txt", "text/plain", true},
		{"text/html", "a.html", "", false}, {"application/pdf", "a.pdf", "", false}, {"", "a.bin", "", false},
	} {
		if got, ok := fileTextIndexMIME(c.mime, c.name); got != c.want || ok != c.ok {
			t.Errorf("fileTextIndexMIME(%q, %q) = %q %v", c.mime, c.name, got, ok)
		}
	}
	d := attachtext.Doc{Parts: []attachtext.Part{{Label: "Slide 1"}, {Label: "Slide 2", Text: "bb"}, {Text: strings.Repeat("ê", maxSearchContentRunes)}}}
	got := fileIndexText(d)
	if !strings.HasPrefix(got, "Slide 1\nbb\n") || len([]rune(got)) != maxSearchContentRunes {
		t.Errorf("fileIndexText = %d runes, prefix %q", len([]rune(got)), got[:12])
	}
}

func TestSearchSnippetShowsTheMatch(t *testing.T) {
	x := newMcpToolWorld(t)
	idx := NewDocumentTextIndexer(x.docs(t), x.tools.ask, nil)
	ctx := context.Background()
	id := x.textFile(t, "hd.docx", textIndexDocx(t))
	doc, err := x.docs(t).q.GetDocumentByID(ctx, id)
	mustf(t, err, "get")
	mustf(t, idx.Index(ctx, doc.OrganizationID, id, doc.FileVersionID.String), "index")

	raw, err := callMcpTool(t, x.tools, x.p, "search", `{"workspace_id":"`+x.w.ID+`","query":"`+textIndexQuery+`"}`)
	mustf(t, err, "search")
	var items []McpItem
	mustf(t, json.Unmarshal(raw, &items), "decode")
	for _, it := range items {
		if it.ID == id {
			if !strings.Contains(it.Excerpt, "bảo hành 24 tháng") {
				t.Fatalf("excerpt = %q", it.Excerpt)
			}
			return
		}
	}
	t.Fatalf("file not found: %s", raw)
}

func TestAskUniSearchFindsWordsDeepInAFile(t *testing.T) {
	x, s, tc := newAgentWorld(t)
	ctx := context.Background()
	s.SetDocuments(x.docs(t))
	s.SetFlags(agentFlagFake{org: x.w.OrganizationID})
	idx := NewDocumentTextIndexer(x.docs(t), s, nil)
	id := x.textFile(t, "hd.docx", textIndexDocx(t))
	doc, err := x.docs(t).q.GetDocumentByID(ctx, id)
	mustf(t, err, "get")
	mustf(t, idx.Index(ctx, doc.OrganizationID, id, doc.FileVersionID.String), "index")

	for _, it := range runAgentTool(t, s, tc, "search", `{"query":"điều khoản bảo hành"}`) {
		if it.ID == id {
			return
		}
	}
	t.Fatal("Ask UNI search dropped the file whose body holds the words")
}

func TestRestrictedFileBodyStaysHidden(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "snip")
	admin := Human(tn.wsAdmin.ID)
	doc := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "restricted", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	body := strings.Repeat("mở đầu ", 60) + textIndexPhrase
	_, err := f.pool.Exec(f.ctx, `UPDATE documents SET title = 'Hợp đồng mua', content_text = $2, search_text = $3 WHERE id = $1`,
		doc.ID, body, foldForSearch("Hợp đồng mua "+body))
	mustf(t, err, "seed")

	list := func(q string) (DocumentListItem, bool) {
		page, err := f.svc.ListDocuments(f.ctx, admin, tn.wsA, ListDocumentsInput{Query: q})
		mustf(t, err, "list")
		for _, it := range page.Items {
			if it.Document.ID == doc.ID {
				return it, true
			}
		}
		return DocumentListItem{}, false
	}
	if _, ok := list(textIndexQuery); ok {
		t.Fatal("a body-only search matched a restricted file the admin cannot read")
	}
	if it, ok := list("hop dong"); !ok || it.Snippet != "" {
		t.Fatalf("title search = snippet %q, found %v; want found with an empty snippet", it.Snippet, ok)
	}
}

func TestTextIndexSurvivesAnExtractorPanic(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	idx := NewDocumentTextIndexer(env.svc, nil, nil)
	res := env.createFile(t, human(env.tn.member), "hd.docx", textIndexDocx(t))
	_, err := env.f.pool.Exec(context.Background(), `UPDATE documents SET content_text = 'cũ' WHERE id = $1`, res.Document.ID)
	mustf(t, err, "seed")
	old := extractFileText
	extractFileText = func(string, io.ReaderAt, int64) (attachtext.Doc, error) { panic("crafted file") }
	defer func() { extractFileText = old }()

	mustf(t, idx.Index(context.Background(), env.tn.orgID, res.Document.ID, res.Document.FileVersionID.String), "index")
	if row := readTextIndexRow(t, env.f.pool, res.Document.ID); row.Content != "" {
		t.Fatalf("content_text = %q, want empty", row.Content)
	}
}

func TestTextIndexDropsAFileThatIsGone(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	idx := NewDocumentTextIndexer(env.svc, nil, nil)
	res := env.createFile(t, human(env.tn.member), "hd.docx", textIndexDocx(t))
	_, err := env.f.pool.Exec(context.Background(), `UPDATE documents SET content_text = 'cũ' WHERE id = $1`, res.Document.ID)
	mustf(t, err, "seed")
	var fileID string
	mustf(t, env.f.pool.QueryRow(context.Background(), `SELECT file_id FROM document_versions WHERE id = $1`, res.Document.FileVersionID.String).Scan(&fileID), "file id")
	env.fake.SimulateGC(files.FileID(fileID))

	mustf(t, idx.Index(context.Background(), env.tn.orgID, res.Document.ID, res.Document.FileVersionID.String), "index a deleting file")
	if row := readTextIndexRow(t, env.f.pool, res.Document.ID); row.Content != "" {
		t.Fatalf("content_text = %q, want empty", row.Content)
	}
}

func TestTextIndexRetriesWhenStorageIsDown(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	idx := NewDocumentTextIndexer(env.svc, nil, nil)
	res := env.createFile(t, human(env.tn.member), "hd.docx", textIndexDocx(t))
	env.fake.SetStorageDown(true)
	defer env.fake.SetStorageDown(false)
	if err := idx.Index(context.Background(), env.tn.orgID, res.Document.ID, res.Document.FileVersionID.String); err == nil {
		t.Fatal("Index returned nil while storage was down; the outbox must retry")
	}
}

func TestTextIndexSkipsTypesItCannotRead(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	idx := NewDocumentTextIndexer(env.svc, nil, nil)
	ctx := context.Background()
	idx.reads <- struct{}{} // a read would block on the slot
	defer func() { <-idx.reads }()
	for _, mime := range []string{"text/html", "image/png"} {
		res := env.createFile(t, human(env.tn.member), "x-"+strings.ReplaceAll(mime, "/", "-")+".docx", textIndexDocx(t))
		_, err := env.f.pool.Exec(ctx, `UPDATE document_versions SET mime_type = $2 WHERE id = $1`, res.Document.FileVersionID.String, mime)
		mustf(t, err, "mime")
		before := readTextIndexRow(t, env.f.pool, res.Document.ID)
		tctx, cancel := context.WithTimeout(ctx, 2*time.Second)
		err = idx.Index(tctx, env.tn.orgID, res.Document.ID, res.Document.FileVersionID.String)
		cancel()
		mustf(t, err, "index %s", mime)
		if after := readTextIndexRow(t, env.f.pool, res.Document.ID); after != before {
			t.Fatalf("%s: row changed: before %+v after %+v", mime, before, after)
		}
	}
}

func TestFileIndexText(t *testing.T) {
	slides := attachtext.Doc{Unit: "slide", Parts: []attachtext.Part{{Label: "Slide 1"}, {Label: "Slide 2", Text: "bb"}}}
	if got := fileIndexText(slides); got != "bb" {
		t.Errorf("empty slide: got %q, want %q", got, "bb")
	}
	sheets := attachtext.Doc{Unit: "row", Parts: []attachtext.Part{{Label: "Sheet1"}, {Text: "x"}}}
	if got := fileIndexText(sheets); got != "Sheet1\nx" {
		t.Errorf("sheet label: got %q", got)
	}
	// The separator counts: a part that fills the window exactly leaves no room for "\n" or more.
	full := attachtext.Doc{Parts: []attachtext.Part{{Text: strings.Repeat("a", maxSearchContentRunes)}, {Text: "z"}}}
	if got := fileIndexText(full); len([]rune(got)) != maxSearchContentRunes || strings.Contains(got, "\n") {
		t.Errorf("window overflow: %d runes", len([]rune(got)))
	}
	one := attachtext.Doc{Parts: []attachtext.Part{{Text: strings.Repeat("a", maxSearchContentRunes-1)}, {Text: "zz"}}}
	if got := fileIndexText(one); len([]rune(got)) != maxSearchContentRunes {
		t.Errorf("separator counted: %d runes", len([]rune(got)))
	}
}

func TestTextIndexTopicIsInTheCatalogue(t *testing.T) {
	if _, ok := outbox.Lookup(topicDocumentTextIndexRequested); !ok {
		t.Fatalf("%q is not in the outbox catalogue", topicDocumentTextIndexRequested)
	}
}
