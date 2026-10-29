package service

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/mail"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-2113: GET .../documents/sources takes the repeated ?type= of the
// document lists. The pure vocabulary is held here without a database; the
// listing itself is held by TestDocumentSourceListsRepeatedTypes.

func TestDocumentSourceTypeFilter(t *testing.T) {
	for _, c := range []struct {
		name  string
		types []string
		want  []string
	}{
		{"none is the whole source set", nil, documentSourceAllExts},
		{"one type", []string{"pdf"}, []string{"pdf"}},
		{"a type with two extensions", []string{"docx"}, []string{"docx", "doc"}},
		{"types add up", []string{"pdf", "docx"}, []string{"docx", "doc", "pdf"}},
		{"txt is a source type", []string{"txt"}, []string{"txt"}},
		{"page adds no extension", []string{"page", "pdf"}, []string{"pdf"}},
		{"a repeat counts once", []string{"pdf", "pdf"}, []string{"pdf"}},
		// A list type sources cannot hold narrows to nothing, never to all.
		{"page alone is empty", []string{"page"}, []string{}},
	} {
		t.Run(c.name, func(t *testing.T) {
			mode, got, err := documentSourceTypeFilter(c.types)
			if err != nil {
				t.Fatal(err)
			}
			if mode != "ext" {
				t.Errorf("mode = %q, want ext", mode)
			}
			g, w := append([]string{}, got...), append([]string{}, c.want...)
			sort.Strings(g)
			sort.Strings(w)
			if !reflect.DeepEqual(g, w) {
				t.Errorf("exts = %v, want %v", got, c.want)
			}
		})
	}
}

func TestDocumentSourceTypeFilterRefusesWhatNoListAccepts(t *testing.T) {
	for _, types := range [][]string{
		{"image"}, {"other"}, {"PDF"}, {""}, {"pdf", "bogus"}, {"page", ""},
	} {
		_, _, err := documentSourceTypeFilter(types)
		if !codedIs(err, "invalid_type") {
			t.Errorf("types %q: err = %v, want 400 invalid_type", types, err)
		}
	}
}

// Every value the list routes accept is accepted here too, so one picker can
// send the same repeated type to every route.
func TestDocumentSourceTypeFilterAcceptsTheListVocabulary(t *testing.T) {
	for _, typ := range []string{"page", "docx", "xlsx", "pptx", "pdf", "md", "html", "txt"} {
		if _, _, err := documentSourceTypeFilter([]string{typ}); err != nil {
			t.Errorf("type=%s: %v", typ, err)
		}
	}
}

// UNI-2288: documentSourceIncludesPages is true when no ?type= filter is passed
// or when "page" is among the values, and documentSourceMeetingItem maps both
// file and page rows without running file extension/policy logic on pages.
func TestDocumentSourceIncludesPagesAndMeetingItemMapper(t *testing.T) {
	for _, c := range []struct {
		types []string
		want  bool
	}{
		{nil, true},
		{[]string{}, true},
		{[]string{"page"}, true},
		{[]string{"pdf", "page"}, true},
		{[]string{"pdf"}, false},
		{[]string{"docx", "xlsx"}, false},
	} {
		if got := documentSourceIncludesPages(c.types); got != c.want {
			t.Errorf("documentSourceIncludesPages(%v) = %v, want %v", c.types, got, c.want)
		}
	}

	policy := documentFilePolicyFor(nil)
	pageItem := documentSourceMeetingItem(db.ListDocumentSourceMeetingFilesRow{
		RowID:       "01MTG",
		SourceID:    "meeting:minutes:01MTG",
		Kind:        DocumentKindPage,
		DocumentID:  "01DOC",
		ParentKind:  "meeting",
		ParentID:    "01MTG",
		ParentTitle: "Giao ban.pdf",
		Name:        "Giao ban.pdf",
	}, policy)
	if pageItem.Kind != DocumentKindPage || pageItem.DocumentID != "01DOC" || pageItem.Name != "Giao ban.pdf" ||
		pageItem.Extension != "" || pageItem.MimeType != "" || pageItem.SizeBytes != 0 ||
		pageItem.CanOpenInApp || pageItem.CanSave || pageItem.Owner != nil {
		t.Fatalf("pageItem = %+v", pageItem)
	}

	fileItem := documentSourceMeetingItem(db.ListDocumentSourceMeetingFilesRow{
		RowID:       "01REC",
		SourceID:    "meeting:01REC",
		Kind:        DocumentKindFile,
		ParentKind:  "meeting",
		ParentID:    "01MTG",
		ParentTitle: "Giao ban",
		Name:        "recording.pdf",
		MimeType:    "application/pdf",
		SizeBytes:   2048,
		OwnerID:     "01USR",
		OwnerKind:   "member",
		OwnerName:   "An",
	}, policy)
	if fileItem.Kind != DocumentKindFile || fileItem.DocumentID != "" || fileItem.Extension != "pdf" ||
		!fileItem.CanSave || fileItem.Owner == nil || fileItem.Owner.Kind != "human" {
		t.Fatalf("fileItem = %+v", fileItem)
	}
}

type fakeMinutesTitleGateDB struct {
	rows    []db.ListMinutesMeetingsByDocumentIDsRow
	gateErr map[string]error
}

func (f *fakeMinutesTitleGateDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}

func (f *fakeMinutesTitleGateDB) Query(_ context.Context, sql string, _ ...any) (pgx.Rows, error) {
	if strings.Contains(sql, "ListMinutesMeetingsByDocumentIDs") {
		return &fakeMinutesRows{rows: f.rows}, nil
	}
	return &fakeMinutesRows{}, nil
}

func (f *fakeMinutesTitleGateDB) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	if strings.Contains(sql, "GetWorkspaceAccess") && len(args) > 0 {
		wsID, _ := args[0].(string)
		if err, ok := f.gateErr[wsID]; ok {
			return fakeMinutesErrRow{err: err}
		}
		return fakeMinutesAccessRow{orgID: "org-1", role: "member"}
	}
	return fakeMinutesErrRow{err: pgx.ErrNoRows}
}

type fakeMinutesRows struct {
	rows []db.ListMinutesMeetingsByDocumentIDsRow
	idx  int
}

func (r *fakeMinutesRows) Close()                                       {}
func (r *fakeMinutesRows) Err() error                                   { return nil }
func (r *fakeMinutesRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeMinutesRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeMinutesRows) Values() ([]any, error)                       { return nil, nil }
func (r *fakeMinutesRows) RawValues() [][]byte                          { return nil }
func (r *fakeMinutesRows) Conn() *pgx.Conn                              { return nil }
func (r *fakeMinutesRows) Next() bool {
	if r.idx >= len(r.rows) {
		return false
	}
	r.idx++
	return true
}
func (r *fakeMinutesRows) Scan(dest ...any) error {
	cur := r.rows[r.idx-1]
	*(dest[0].(*string)) = cur.DocumentID
	*(dest[1].(*string)) = cur.MeetingID
	*(dest[2].(*string)) = cur.WorkspaceID
	*(dest[3].(*string)) = cur.MeetingTitle
	return nil
}

type fakeMinutesErrRow struct{ err error }

func (r fakeMinutesErrRow) Scan(...any) error { return r.err }

type fakeMinutesAccessRow struct {
	orgID string
	role  string
}

func (r fakeMinutesAccessRow) Scan(dest ...any) error {
	*(dest[0].(*string)) = r.role
	*(dest[1].(*string)) = r.orgID
	*(dest[2].(*string)) = "active"
	*(dest[3].(*string)) = "member"
	*(dest[5].(*bool)) = false
	return nil
}

// UNI-2288 (RB1-3): an infrastructure error from the meeting-workspace title gate
// during list/tree enrichment leaves the title absent for that workspace, retains
// all rows (including other workspaces' titles), logs the failure with IDs and
// correlation_id (never the meeting title), and still propagates context cancellation
// as well as single-document GET errors.
func TestMinutesTitleGateInfrastructureErrorKeepsListRowsAndLogsWithoutTitle(t *testing.T) {
	dbFailure := errors.New("connection reset by peer")
	secretTitle := "Họp chiến lược M&A tuyệt mật"
	healthyTitle := "Giao ban sản phẩm"
	fakeDB := &fakeMinutesTitleGateDB{
		rows: []db.ListMinutesMeetingsByDocumentIDsRow{
			{DocumentID: "doc-broken", MeetingID: "mtg-broken", MeetingTitle: secretTitle, WorkspaceID: "ws-broken"},
			{DocumentID: "doc-healthy", MeetingID: "mtg-healthy", MeetingTitle: healthyTitle, WorkspaceID: "ws-healthy"},
		},
		gateErr: map[string]error{"ws-broken": dbFailure},
	}
	q := db.New(fakeDB)
	orgs := NewOrganizationService(nil, q)
	ws := NewWorkspaceService(nil, q, orgs, mail.Renderer{}, nil)
	docs := NewDocumentService(nil, q, orgs, ws)

	var logs bytes.Buffer
	prevLog := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(prevLog) })

	ctx := audit.WithRequest(context.Background(), audit.RequestInfo{CorrelationID: "corr-rb1-3-test"})
	items := []DocumentListItem{
		{
			Document: db.Document{ID: "doc-broken", OrganizationID: "org-1", WorkspaceID: "ws-broken", Kind: DocumentKindPage},
			Access:   DocumentAccess{Level: DocumentLevelView, Via: DocumentViaMember},
		},
		{
			Document: db.Document{ID: "doc-healthy", OrganizationID: "org-1", WorkspaceID: "ws-healthy", Kind: DocumentKindPage},
			Access:   DocumentAccess{Level: DocumentLevelView, Via: DocumentViaMember},
		},
	}
	if err := docs.attachListMinutesMeetings(ctx, Human("usr-1"), items); err != nil {
		t.Fatalf("attachListMinutesMeetings returned error on title-gate infra failure: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("items len = %d, want 2", len(items))
	}
	if mm := items[0].Facts.MinutesMeeting; mm == nil || mm.ID != "mtg-broken" || mm.Title != "" {
		t.Fatalf("broken workspace MinutesMeeting = %+v, want {ID:mtg-broken Title:\"\"}", mm)
	}
	if mm := items[1].Facts.MinutesMeeting; mm == nil || mm.ID != "mtg-healthy" || mm.Title != healthyTitle {
		t.Fatalf("healthy workspace MinutesMeeting = %+v, want {ID:mtg-healthy Title:%q}", mm, healthyTitle)
	}
	logLine := logs.String()
	for _, want := range []string{"org-1", "ws-broken", "usr-1", "corr-rb1-3-test", "connection reset by peer"} {
		if !strings.Contains(logLine, want) {
			t.Fatalf("log output missing %q: %s", want, logLine)
		}
	}
	if strings.Contains(logLine, secretTitle) {
		t.Fatalf("log output leaked meeting title %q: %s", secretTitle, logLine)
	}

	// Tree enrichment also retains nodes and leaves the failed workspace's title absent.
	treeNodes := []DocumentTreeNode{
		{ID: "doc-broken", Kind: DocumentKindPage},
		{ID: "doc-healthy", Kind: DocumentKindPage},
	}
	docsByID := map[string]db.Document{
		"doc-broken":  {ID: "doc-broken", OrganizationID: "org-1", WorkspaceID: "ws-broken", Kind: DocumentKindPage, Visibility: "workspace", WorkspaceLevel: "view"},
		"doc-healthy": {ID: "doc-healthy", OrganizationID: "org-1", WorkspaceID: "ws-healthy", Kind: DocumentKindPage, Visibility: "workspace", WorkspaceLevel: "view"},
	}
	scope := documentListScope{organizationID: "org-1", actorID: "usr-1", memberVisible: true}
	if err := docs.attachTreeMinutesMeetings(ctx, Human("usr-1"), scope, "ws-healthy", false, docsByID, treeNodes); err != nil {
		t.Fatalf("attachTreeMinutesMeetings returned error on title-gate infra failure: %v", err)
	}
	if mm := treeNodes[0].MinutesMeeting; mm == nil || mm.ID != "mtg-broken" || mm.Title != "" {
		t.Fatalf("broken tree node MinutesMeeting = %+v, want {ID:mtg-broken Title:\"\"}", mm)
	}
	if mm := treeNodes[1].MinutesMeeting; mm == nil || mm.ID != "mtg-healthy" || mm.Title != healthyTitle {
		t.Fatalf("healthy tree node MinutesMeeting = %+v, want {ID:mtg-healthy Title:%q}", mm, healthyTitle)
	}

	// Single-document read still returns the error.
	if _, err := docs.minutesMeetingForDocument(ctx, q, Human("usr-1"), items[0].Document); !errors.Is(err, dbFailure) {
		t.Fatalf("minutesMeetingForDocument err = %v, want %v", err, dbFailure)
	}

	// Context cancellation is preserved on list enrichment too.
	cctx, cancel := context.WithCancel(ctx)
	cancel()
	fakeDB.gateErr["ws-broken"] = context.Canceled
	if err := docs.attachListMinutesMeetings(cctx, Human("usr-1"), items); !errors.Is(err, context.Canceled) {
		t.Fatalf("attachListMinutesMeetings with canceled ctx = %v, want context.Canceled", err)
	}
}

// Repeated types are OR-ed over the source rows, a type sources cannot hold
// (page) adds nothing, and a page-only pick is an empty page rather than the
// whole set. The cursor of a multi-type page walks the same union.
func TestDocumentSourceListsRepeatedTypes(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	s := newSourceSceneOn(t, env)
	svc, _ := sourceService(t, env)
	tn := env.tn
	taskA := s.task(tn, tn.wsA)
	docx := "task:" + s.attachmentWith(tn, tn.wsA, taskA, "plan.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 5, "")
	doc := "task:" + s.attachmentWith(tn, tn.wsA, taskA, "old.doc", "application/msword", 5, "")
	pdf := "task:" + s.attachmentWith(tn, tn.wsA, taskA, "spec.pdf", "application/pdf", 5, "")
	txt := "task:" + s.attachmentWith(tn, tn.wsA, taskA, "notes.txt", "text/plain", 5, "")
	xlsx := "task:" + s.attachmentWith(tn, tn.wsA, taskA, "sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 5, "")

	ids := func(types []string, limit int) map[string]bool {
		t.Helper()
		got := map[string]bool{}
		cursor := ""
		for pages := 0; pages < 10; pages++ {
			page, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{Types: types, Cursor: cursor, Limit: limit})
			if err != nil {
				t.Fatalf("types %v: %v", types, err)
			}
			for _, it := range page.Items {
				if got[it.ID] {
					t.Fatalf("types %v: %s listed twice", types, it.ID)
				}
				got[it.ID] = true
			}
			if page.NextCursor == "" {
				return got
			}
			cursor = page.NextCursor
		}
		t.Fatalf("types %v: paging never ended", types)
		return nil
	}
	same := func(types []string, limit int, want ...string) {
		t.Helper()
		got := ids(types, limit)
		if len(got) != len(want) {
			t.Errorf("types %v: got %v, want %v", types, got, want)
			return
		}
		for _, id := range want {
			if !got[id] {
				t.Errorf("types %v: %s missing from %v", types, id, got)
			}
		}
	}

	same(nil, 0, docx, doc, pdf, txt, xlsx)
	same([]string{"pdf"}, 0, pdf)
	same([]string{"docx", "pdf"}, 0, docx, doc, pdf)
	same([]string{"docx", "pdf", "txt"}, 2, docx, doc, pdf, txt)
	same([]string{"page", "xlsx"}, 0, xlsx)
	same([]string{"pdf", "pdf"}, 0, pdf)
	same([]string{"page"}, 0)

	for _, types := range [][]string{{"pdf", "bogus"}, {""}, {"image"}} {
		_, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{Types: types})
		if !codedIs(err, "invalid_type") {
			t.Errorf("types %q: err = %v, want 400 invalid_type", types, err)
		}
	}
}
