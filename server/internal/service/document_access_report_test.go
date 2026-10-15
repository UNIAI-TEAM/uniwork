package service

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Access report (UNI-1643) service tests, contract v1 §10 S1-S9.

type arDocSpec struct {
	ws, kind, title, visibility, parent, aclOwner, ownerID string
	archived                                               bool
}

func (f *docPermFixture) arDoc(t *testing.T, tn docTenant, s arDocSpec) db.Document {
	t.Helper()
	id := util.NewID()
	ws := s.ws
	if ws == "" {
		ws = tn.wsA
	}
	row := baseDoc(map[string]any{
		"id": id, "organization_id": tn.orgID, "workspace_id": ws,
		"created_by": tn.owner.ID, "updated_by": tn.owner.ID,
	})
	if s.kind != "" {
		row["kind"] = s.kind
	}
	if s.title != "" {
		row["title"] = s.title
	}
	if s.visibility != "" {
		row["visibility"] = s.visibility
	}
	if s.parent != "" {
		row["parent_id"] = s.parent
	}
	if s.aclOwner != "" {
		row["acl_owner_id"] = s.aclOwner
	}
	if s.ownerID != "" {
		row["owner_kind"] = "work_product"
		row["owner_id"] = s.ownerID
	}
	if s.archived {
		row["archived_at"] = time.Now()
	}
	insertRow(t, f.ctx, f.pool, "documents", row)
	d, err := f.q.GetDocumentByID(f.ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func (f *docPermFixture) arLink(t *testing.T, d db.Document, by string, expires time.Time) {
	t.Helper()
	if _, err := f.q.InsertDocumentShareLink(f.ctx, db.InsertDocumentShareLinkParams{
		ID: util.NewID(), OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID, DocumentID: d.ID,
		TokenHash: util.NewID(), ExpiresAt: pgtype.Timestamptz{Time: expires, Valid: true},
		CreatedBy: by, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
}

func (f *docPermFixture) report(t *testing.T, actor Actor, ws string, in DocumentAccessReportQuery) DocumentAccessReportPage {
	t.Helper()
	page, err := f.svc.DocumentAccessReport(f.ctx, actor, ws, in)
	if err != nil {
		t.Fatalf("DocumentAccessReport: %v", err)
	}
	return page
}

func arIDs(page DocumentAccessReportPage) []string {
	out := make([]string, 0, len(page.Items))
	for _, it := range page.Items {
		out = append(out, it.Item.Document.ID)
	}
	return out
}

func arSorted(ids ...string) []string {
	out := append([]string(nil), ids...)
	sort.Strings(out)
	return out
}

func arItem(t *testing.T, page DocumentAccessReportPage, id string) DocumentAccessReportItem {
	t.Helper()
	for _, it := range page.Items {
		if it.Item.Document.ID == id {
			return it
		}
	}
	t.Fatalf("document %s is not in the report (%v)", id, arIDs(page))
	return DocumentAccessReportItem{}
}

// arRowKey is the comparable part of a row the tests pin.
func arRowKey(r DocumentAccessReportRow) string {
	active := "inactive"
	if r.Active {
		active = "active"
	}
	return strings.Join([]string{r.Source, r.Via, r.PrincipalType, r.PrincipalID, r.Level, r.EffectiveLevel, active}, "|")
}

func arRowKeys(it DocumentAccessReportItem) []string {
	out := make([]string, 0, len(it.Rows))
	for _, r := range it.Rows {
		out = append(out, arRowKey(r))
	}
	return out
}

func arSame(t *testing.T, label string, got, want []string) {
	t.Helper()
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("%s:\n got  %v\n want %v", label, got, want)
	}
}

func TestAccessReportWorkspaceScopeListsManagedDocs(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "ar1")
	d1 := f.arDoc(t, tn, arDocSpec{title: "Hợp đồng ABC", visibility: "workspace", aclOwner: tn.aclOwner.ID})
	shUser := f.share(t, d1, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)
	f.share(t, d1, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelEdit, tn.aclOwner.ID)
	f.arLink(t, d1, tn.aclOwner.ID, time.Now().Add(24*time.Hour))
	f.arLink(t, d1, tn.aclOwner.ID, time.Now().Add(-time.Hour))
	d2 := f.arDoc(t, tn, arDocSpec{visibility: "restricted"})
	f.arDoc(t, tn, arDocSpec{ownerID: util.NewID()})
	f.arDoc(t, tn, arDocSpec{archived: true})
	f.arDoc(t, tn, arDocSpec{ws: tn.wsB})

	page := f.report(t, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{})
	arSame(t, "listed", arIDs(page), arSorted(d1.ID, d2.ID))
	if page.Candidates != 2 || page.Skipped != 0 || page.NextAfterID != "" || page.FolderID != "" {
		t.Fatalf("page counters: %+v", page)
	}
	if page.GeneratedAt.IsZero() {
		t.Fatal("generated_at is not set")
	}
	it := arItem(t, page, d1.ID)
	if it.ACLOwnerName != "aclowner" || it.LiveLinkCount != 1 || it.Item.Document.Visibility != "workspace" {
		t.Fatalf("document block: owner=%q links=%d visibility=%q", it.ACLOwnerName, it.LiveLinkCount, it.Item.Document.Visibility)
	}
	if it.Item.Access.Level != DocumentLevelManage {
		t.Fatalf("caller level = %q", it.Item.Access.Level)
	}
	arSame(t, "d1 rows", arRowKeys(it), []string{
		"acl_owner|member|user|" + tn.aclOwner.ID + "|manage|manage|active",
		"workspace|member|workspace|" + tn.wsA + "|edit|edit|active",
		"share|share|user|" + tn.member.ID + "|view|edit|active",
		"share|share|workspace|" + tn.wsB + "|edit|edit|active",
	})
	acl, ws, user, wsShare := it.Rows[0], it.Rows[1], it.Rows[2], it.Rows[3]
	if acl.PrincipalName != "aclowner" || acl.GrantedBy != "" || acl.GrantedAt != nil || acl.ShareID != "" {
		t.Fatalf("acl_owner row: %+v", acl)
	}
	if ws.PrincipalName != "A ar1" || ws.GrantedAt != nil {
		t.Fatalf("workspace row: %+v", ws)
	}
	if user.PrincipalName != "member" || user.ShareID != shUser.ID || user.GrantedBy != tn.aclOwner.ID ||
		user.GrantedByName != "aclowner" || user.GrantedByKind != "human" || user.GrantedAt == nil {
		t.Fatalf("user share row: %+v", user)
	}
	if wsShare.PrincipalName != "B ar1" {
		t.Fatalf("workspace share row: %+v", wsShare)
	}
	if rows := arItem(t, page, d2.ID).Rows; len(rows) != 0 {
		t.Fatalf("restricted unshared doc rows = %+v", rows)
	}
}

func TestAccessReportFolderScopeIsRecursiveAndIncludesRoot(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "ar2")
	root := f.arDoc(t, tn, arDocSpec{kind: DocumentKindFolder, title: "Hợp đồng"})
	sub := f.arDoc(t, tn, arDocSpec{kind: DocumentKindFolder, parent: root.ID})
	deep := f.arDoc(t, tn, arDocSpec{parent: sub.ID})
	direct := f.arDoc(t, tn, arDocSpec{parent: root.ID})
	f.arDoc(t, tn, arDocSpec{})                               // outside the folder
	f.arDoc(t, tn, arDocSpec{parent: sub.ID, archived: true}) // in the trash

	page := f.report(t, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{FolderID: root.ID})
	arSame(t, "listed", arIDs(page), arSorted(root.ID, sub.ID, deep.ID, direct.ID))
	if page.FolderID != root.ID || page.FolderTitle != "Hợp đồng" {
		t.Fatalf("scope = %q %q", page.FolderID, page.FolderTitle)
	}
	if got := arItem(t, page, deep.ID).Item.Path; len(got) != 2 || got[0].ID != root.ID || got[1].ID != sub.ID {
		t.Fatalf("deep path = %+v", got)
	}
}

func TestAccessReportEditOnlyViewerSeesNoGrantsAndSkippedCounts(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "ar3")
	owned := f.arDoc(t, tn, arDocSpec{visibility: "restricted", aclOwner: tn.member.ID})
	f.share(t, owned, DocumentPrincipalUser, tn.creator.ID, DocumentLevelView, tn.member.ID)
	editable := f.arDoc(t, tn, arDocSpec{visibility: "workspace"})
	f.share(t, editable, DocumentPrincipalUser, tn.creator.ID, DocumentLevelView, tn.owner.ID)
	sharedView := f.arDoc(t, tn, arDocSpec{visibility: "restricted"})
	f.share(t, sharedView, DocumentPrincipalUser, tn.member.ID, DocumentLevelEdit, tn.owner.ID)
	f.arDoc(t, tn, arDocSpec{visibility: "restricted"}) // unreadable: neither listed nor counted

	page := f.report(t, Human(tn.member.ID), tn.wsA, DocumentAccessReportQuery{})
	arSame(t, "listed", arIDs(page), []string{owned.ID})
	if page.Skipped != 2 || page.Candidates != 4 {
		t.Fatalf("skipped=%d candidates=%d, want 2 and 4", page.Skipped, page.Candidates)
	}
}

func TestAccessReportRefusals(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "ar4")
	shared := f.arDoc(t, tn, arDocSpec{visibility: "restricted"})
	f.share(t, shared, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelManage, tn.owner.ID)
	folderB := f.arDoc(t, tn, arDocSpec{ws: tn.wsB, kind: DocumentKindFolder})
	page := f.arDoc(t, tn, arDocSpec{})
	trashed := f.arDoc(t, tn, arDocSpec{kind: DocumentKindFolder, archived: true})

	for _, c := range []struct {
		name  string
		actor Actor
		in    DocumentAccessReportQuery
		want  error
	}{
		{"agent", agentActor(tn.agent), DocumentAccessReportQuery{}, ErrForbidden},
		{"workspace non-member with a share", Human(tn.outsider.ID), DocumentAccessReportQuery{}, ErrForbidden},
		{"deactivated member", Human(tn.deact.ID), DocumentAccessReportQuery{}, ErrMemberDeactivated},
		{"folder of another workspace", Human(tn.owner.ID), DocumentAccessReportQuery{FolderID: folderB.ID}, ErrNotFound},
		{"page as folder", Human(tn.owner.ID), DocumentAccessReportQuery{FolderID: page.ID}, ErrNotFound},
		{"archived folder", Human(tn.owner.ID), DocumentAccessReportQuery{FolderID: trashed.ID}, ErrNotFound},
		{"missing folder", Human(tn.owner.ID), DocumentAccessReportQuery{FolderID: util.NewID()}, ErrNotFound},
	} {
		t.Run(c.name, func(t *testing.T) {
			_, err := f.svc.DocumentAccessReport(f.ctx, c.actor, tn.wsA, c.in)
			if !errors.Is(err, c.want) {
				t.Fatalf("err = %v, want %v", err, c.want)
			}
		})
	}
}

func TestAccessReportKeysetIsStable(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "ar5")
	var want []string
	for i := 0; i < 5; i++ {
		want = append(want, f.arDoc(t, tn, arDocSpec{}).ID)
	}
	var got []string
	after := ""
	for pages := 0; ; pages++ {
		if pages > 10 {
			t.Fatal("paging does not end")
		}
		p := f.report(t, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{AfterID: after, Limit: 2})
		got = append(got, arIDs(p)...)
		if pages == 0 {
			if p.NextAfterID == "" || len(p.Items) != 2 {
				t.Fatalf("first page: %d items, next %q", len(p.Items), p.NextAfterID)
			}
			// A document created while paging has a larger id: a later page.
			want = append(want, f.arDoc(t, tn, arDocSpec{}).ID)
		}
		if p.NextAfterID == "" {
			break
		}
		after = p.NextAfterID
	}
	arSame(t, "all pages", got, arSorted(want...))
}

func TestAccessReportEffectiveLevel(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "ar6")
	d := f.arDoc(t, tn, arDocSpec{visibility: "workspace"})
	f.share(t, d, DocumentPrincipalUser, tn.wsAdmin.ID, DocumentLevelView, tn.owner.ID)
	f.share(t, d, DocumentPrincipalUser, tn.deact.ID, DocumentLevelView, tn.owner.ID)
	f.share(t, d, DocumentPrincipalWorkspace, tn.wsA, DocumentLevelView, tn.owner.ID)
	f.share(t, d, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelView, tn.owner.ID)
	f.share(t, d, DocumentPrincipalOrganization, tn.orgID, DocumentLevelEdit, tn.owner.ID)
	r := f.arDoc(t, tn, arDocSpec{visibility: "restricted"})
	f.share(t, r, DocumentPrincipalWorkspace, tn.wsA, DocumentLevelView, tn.owner.ID)

	page := f.report(t, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{})
	arSame(t, "workspace-visible doc", arRowKeys(arItem(t, page, d.ID)), []string{
		"workspace|member|workspace|" + tn.wsA + "|edit|edit|active",
		"share|share|user|" + tn.wsAdmin.ID + "|view|manage|active",
		"share|share|user|" + tn.deact.ID + "|view|none|inactive",
		"share|share|workspace|" + tn.wsA + "|view|edit|active",
		"share|share|workspace|" + tn.wsB + "|view|edit|active",
		"share|share|organization|" + tn.orgID + "|edit|edit|active",
	})
	arSame(t, "restricted doc", arRowKeys(arItem(t, page, r.ID)), []string{
		"share|share|workspace|" + tn.wsA + "|view|view|active",
	})
}

func TestAccessReportPersonFilter(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "ar7")
	p1 := f.arDoc(t, tn, arDocSpec{visibility: "restricted"})
	f.share(t, p1, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.owner.ID)
	f.share(t, p1, DocumentPrincipalUser, tn.creator.ID, DocumentLevelEdit, tn.owner.ID)
	p2 := f.arDoc(t, tn, arDocSpec{visibility: "restricted"})
	f.share(t, p2, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelEdit, tn.owner.ID)
	p3 := f.arDoc(t, tn, arDocSpec{visibility: "workspace"})
	f.arDoc(t, tn, arDocSpec{visibility: "restricted"}) // reaches nobody filtered

	page := f.report(t, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{PersonID: tn.member.ID})
	arSame(t, "member", arIDs(page), arSorted(p1.ID, p3.ID))
	it1 := arItem(t, page, p1.ID)
	arSame(t, "p1 rows", arRowKeys(it1), []string{"share|share|user|" + tn.member.ID + "|view|view|active"})
	if it1.PersonLevel != DocumentLevelView {
		t.Fatalf("p1 person level = %q", it1.PersonLevel)
	}
	it3 := arItem(t, page, p3.ID)
	arSame(t, "p3 rows", arRowKeys(it3), []string{"workspace|member|workspace|" + tn.wsA + "|edit|edit|active"})
	if it3.PersonLevel != DocumentLevelEdit {
		t.Fatalf("p3 person level = %q", it3.PersonLevel)
	}

	page = f.report(t, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{PersonID: tn.bMember.ID})
	arSame(t, "workspace B member", arIDs(page), []string{p2.ID})
	if it := arItem(t, page, p2.ID); it.PersonLevel != DocumentLevelEdit || len(it.Rows) != 1 {
		t.Fatalf("p2 for bMember: %+v", it)
	}

	page = f.report(t, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{PersonID: util.NewID()})
	if len(page.Items) != 0 {
		t.Fatalf("unknown person lists %v", arIDs(page))
	}
}

func TestAccessReportLevelAndVisibilityFilters(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "ar8")
	w := f.arDoc(t, tn, arDocSpec{visibility: "workspace"})
	f.share(t, w, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.owner.ID)
	r := f.arDoc(t, tn, arDocSpec{visibility: "restricted"})
	f.share(t, r, DocumentPrincipalUser, tn.member.ID, DocumentLevelManage, tn.owner.ID)

	page := f.report(t, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{Levels: []string{"view"}})
	arSame(t, "level=view", arIDs(page), []string{w.ID})
	arSame(t, "level=view rows", arRowKeys(page.Items[0]), []string{"share|share|user|" + tn.member.ID + "|view|edit|active"})

	page = f.report(t, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{Levels: []string{"comment"}})
	if len(page.Items) != 0 {
		t.Fatalf("level=comment lists %v", arIDs(page))
	}

	page = f.report(t, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{Visibility: "restricted"})
	arSame(t, "visibility=restricted", arIDs(page), []string{r.ID})
	if page.Candidates != 1 {
		t.Fatalf("visibility narrows candidates first: %d", page.Candidates)
	}

	for _, in := range []DocumentAccessReportQuery{
		{Levels: []string{"owner"}}, {Visibility: "public"},
	} {
		var ve ValidationError
		if _, err := f.svc.DocumentAccessReport(f.ctx, Human(tn.owner.ID), tn.wsA, in); !errors.As(err, &ve) {
			t.Fatalf("%+v: err = %v, want a validation error", in, err)
		}
	}
}

// arQueryCounter counts the statements one pool sends.
type arQueryCounter struct{ n atomic.Int64 }

func (c *arQueryCounter) TraceQueryStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryStartData) context.Context {
	c.n.Add(1)
	return ctx
}

func (c *arQueryCounter) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func TestAccessReportQueryCountIsBounded(t *testing.T) {
	f := newDocPermFixture(t)
	cfg := f.pool.Config()
	counter := &arQueryCounter{}
	cfg.ConnConfig.Tracer = counter
	cPool, err := pgxpool.NewWithConfig(f.ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cPool.Close)
	traced := newDocumentServiceForTest(cPool, db.New(cPool))

	count := func(n int, slug string) int64 {
		tn := f.tenant(t, slug)
		for i := 0; i < n; i++ {
			d := f.arDoc(t, tn, arDocSpec{visibility: "restricted", aclOwner: tn.aclOwner.ID})
			f.share(t, d, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.owner.ID)
			f.share(t, d, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelEdit, tn.owner.ID)
			f.arLink(t, d, tn.owner.ID, time.Now().Add(time.Hour))
		}
		for _, caller := range []string{tn.owner.ID, tn.aclOwner.ID} {
			if _, err := traced.DocumentAccessReport(f.ctx, Human(caller), tn.wsA, DocumentAccessReportQuery{Limit: 100}); err != nil {
				t.Fatal(err)
			}
		}
		counter.n.Store(0)
		total := int64(0)
		for _, caller := range []string{tn.owner.ID, tn.aclOwner.ID} {
			page, err := traced.DocumentAccessReport(f.ctx, Human(caller), tn.wsA, DocumentAccessReportQuery{Limit: 100, PersonID: tn.member.ID})
			if err != nil {
				t.Fatal(err)
			}
			if len(page.Items) != n {
				t.Fatalf("%s: %d items, want %d", slug, len(page.Items), n)
			}
		}
		total = counter.n.Load()
		return total
	}
	small, large := count(10, "ar9s"), count(50, "ar9l")
	if small != large {
		t.Fatalf("queries for 10 documents = %d, for 50 = %d: the report must not grow with the page", small, large)
	}
}
