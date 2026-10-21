package service

import (
	"bytes"
	"encoding/csv"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-2039 S5 (filters), S6 (summary), S7 (principals), S2 (link rows) and
// S3 (origin) over one tenant whose documents each exercise one flag.

type s5World struct {
	f                                   *docPermFixture
	tn                                  docTenant
	actor                               Actor
	contract, finance, plan, plain, big db.Document
	orgShare, wsBShare                  string
}

// newS5World: the ACL owner manages every document, so their report lists
// them all.
func newS5World(t *testing.T, slug string) s5World {
	t.Helper()
	f := newDocPermFixture(t)
	tn := f.tenant(t, slug)
	w := s5World{f: f, tn: tn, actor: Human(tn.aclOwner.ID)}
	w.contract = f.arDoc(t, tn, arDocSpec{title: "Hợp đồng ABC", visibility: "workspace", aclOwner: tn.aclOwner.ID})
	f.share(t, w.contract, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)
	w.wsBShare = f.share(t, w.contract, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelEdit, tn.aclOwner.ID).ID
	f.arLink(t, w.contract, tn.aclOwner.ID, time.Now().Add(24*time.Hour))
	w.finance = f.arDoc(t, tn, arDocSpec{title: "Báo cáo tài chính", visibility: "restricted", aclOwner: tn.aclOwner.ID})
	f.share(t, w.finance, DocumentPrincipalUser, tn.member.ID, DocumentLevelManage, tn.aclOwner.ID)
	w.plan = f.arDoc(t, tn, arDocSpec{title: "Kế hoạch", visibility: "restricted", aclOwner: tn.aclOwner.ID})
	w.orgShare = f.share(t, w.plan, DocumentPrincipalOrganization, tn.orgID, DocumentLevelView, tn.aclOwner.ID).ID
	w.plain = f.arDoc(t, tn, arDocSpec{title: "Plain", visibility: "restricted", aclOwner: tn.aclOwner.ID})
	// A chat share: the same table, a different origin.
	w.big = f.arDoc(t, tn, arDocSpec{title: "Gửi trong chat", visibility: "restricted", aclOwner: tn.aclOwner.ID})
	if _, err := f.q.InsertDocumentShare(f.ctx, db.InsertDocumentShareParams{
		ID: util.NewID(), OrganizationID: w.big.OrganizationID, WorkspaceID: w.big.WorkspaceID, DocumentID: w.big.ID,
		PrincipalType: DocumentPrincipalUser, PrincipalID: tn.creator.ID, Level: "comment",
		GrantedBy: tn.aclOwner.ID, GrantedByKind: "human", Origin: AccessReportOriginChat,
	}); err != nil {
		t.Fatal(err)
	}
	return w
}

func (w s5World) ids(t *testing.T, in DocumentAccessReportQuery) []string {
	t.Helper()
	return arSorted(arIDs(w.f.report(t, w.actor, w.tn.wsA, in))...)
}

func TestAccessReportS5Filters(t *testing.T) {
	w := newS5World(t, "s5a")
	all := arSorted(w.contract.ID, w.finance.ID, w.plan.ID, w.plain.ID, w.big.ID)
	arSame2(t, "no filter", w.ids(t, DocumentAccessReportQuery{}), all)

	for _, c := range []struct {
		name string
		in   DocumentAccessReportQuery
		want []string
	}{
		{"q title, no accent, any case", DocumentAccessReportQuery{Q: "HOP DONG"}, []string{w.contract.ID}},
		{"q title with accent", DocumentAccessReportQuery{Q: "báo cáo"}, []string{w.finance.ID}},
		{"q principal name (member has a row on two)", DocumentAccessReportQuery{Q: "MEMBER"}, []string{w.contract.ID, w.finance.ID}},
		{"q matches the owner row of every document", DocumentAccessReportQuery{Q: "aclowner"}, all},
		{"q finds nothing", DocumentAccessReportQuery{Q: "không-có"}, nil},
		{"principal workspace", DocumentAccessReportQuery{PrincipalType: "workspace", PrincipalID: w.tn.wsB}, []string{w.contract.ID}},
		{"principal organization", DocumentAccessReportQuery{PrincipalType: "organization", PrincipalID: w.tn.orgID}, []string{w.plan.ID}},
		{"principal link, anyone", DocumentAccessReportQuery{PrincipalType: "link"}, []string{w.contract.ID}},
		{"principal user row", DocumentAccessReportQuery{PrincipalType: "user", PrincipalID: w.tn.creator.ID}, []string{w.big.ID}},
		{"person (alias of user:id)", DocumentAccessReportQuery{PersonID: w.tn.member.ID}, arSorted(w.contract.ID, w.finance.ID, w.plan.ID)},
		{"source direct", DocumentAccessReportQuery{Sources: []string{"direct"}}, []string{w.contract.ID, w.finance.ID, w.plan.ID}},
		{"source chat", DocumentAccessReportQuery{Sources: []string{"chat"}}, []string{w.big.ID}},
		{"source link", DocumentAccessReportQuery{Sources: []string{"link"}}, []string{w.contract.ID}},
		{"source owner", DocumentAccessReportQuery{Sources: []string{"owner"}}, all},
		{"source workspace", DocumentAccessReportQuery{Sources: []string{"workspace"}}, []string{w.contract.ID}},
		{"source chat or link", DocumentAccessReportQuery{Sources: []string{"chat", "link"}}, arSorted(w.big.ID, w.contract.ID)},
		{"scope organization", DocumentAccessReportQuery{Scope: "organization"}, []string{w.plan.ID}},
		{"scope workspace", DocumentAccessReportQuery{Scope: "workspace"}, []string{w.contract.ID}},
		{"scope restricted", DocumentAccessReportQuery{Scope: "restricted"}, arSorted(w.finance.ID, w.plain.ID, w.big.ID)},
		{"flag public_link", DocumentAccessReportQuery{Flag: "public_link"}, []string{w.contract.ID}},
		{"flag outside_workspace", DocumentAccessReportQuery{Flag: "outside_workspace"}, arSorted(w.contract.ID, w.plan.ID)},
		{"flag direct_manage", DocumentAccessReportQuery{Flag: "direct_manage"}, []string{w.finance.ID}},
		{"non_default drops owner-only documents", DocumentAccessReportQuery{NonDefault: true}, arSorted(w.contract.ID, w.finance.ID, w.plan.ID, w.big.ID)},
		{"level filter still works", DocumentAccessReportQuery{Levels: []string{"manage"}}, arSorted(w.finance.ID, w.contract.ID, w.plan.ID, w.plain.ID, w.big.ID)},
		{"filters combine", DocumentAccessReportQuery{Flag: "outside_workspace", Sources: []string{"direct"}, Scope: "organization"}, []string{w.plan.ID}},
	} {
		arSame2(t, c.name, w.ids(t, c.in), c.want)
	}

	// Rows: a filtered document keeps only the rows that match.
	page := w.f.report(t, w.actor, w.tn.wsA, DocumentAccessReportQuery{NonDefault: true})
	arSame(t, "non_default rows", arRowKeys(arItem(t, page, w.contract.ID)), []string{
		"share|share|user|" + w.tn.member.ID + "|view|edit|active",
		"share|share|workspace|" + w.tn.wsB + "|edit|edit|active",
		"link|link|link|" + arItem(t, page, w.contract.ID).Rows[2].PrincipalID + "|view|view|active",
	})
	page = w.f.report(t, w.actor, w.tn.wsA, DocumentAccessReportQuery{Sources: []string{"chat"}})
	if rows := arItem(t, page, w.big.ID).Rows; len(rows) != 1 || rows[0].Origin != "chat" {
		t.Fatalf("chat rows = %+v", rows)
	}
	page = w.f.report(t, w.actor, w.tn.wsA, DocumentAccessReportQuery{PrincipalType: "workspace", PrincipalID: w.tn.wsB})
	if rows := arItem(t, page, w.contract.ID).Rows; len(rows) != 1 || rows[0].ShareID != w.wsBShare {
		t.Fatalf("principal rows = %+v", rows)
	}
}

func TestAccessReportS5Validation(t *testing.T) {
	w := newS5World(t, "s5v")
	for name, in := range map[string]DocumentAccessReportQuery{
		"principal type":       {PrincipalType: "group", PrincipalID: "x"},
		"principal without id": {PrincipalType: "workspace"},
		"scope":                {Scope: "public"},
		"source":               {Sources: []string{"email"}},
		"flag":                 {Flag: "shiny"},
		"q too long":           {Q: strings.Repeat("ạ", 101)},
	} {
		_, err := w.f.svc.DocumentAccessReport(w.f.ctx, w.actor, w.tn.wsA, in)
		var ve ValidationError
		if !errors.As(err, &ve) {
			t.Errorf("%s: err = %v, want a validation error", name, err)
		}
	}
	if _, err := w.f.svc.DocumentAccessReport(w.f.ctx, w.actor, w.tn.wsA, DocumentAccessReportQuery{Q: strings.Repeat("ạ", 100)}); err != nil {
		t.Fatalf("a 100-rune q is accepted: %v", err)
	}
}

func TestAccessReportLinkRows(t *testing.T) {
	w := newS5World(t, "s5l")
	expiry := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Second)
	d := w.f.arDoc(t, w.tn, arDocSpec{title: "Có link", visibility: "restricted", aclOwner: w.tn.aclOwner.ID})
	sh := w.f.share(t, d, DocumentPrincipalUser, w.tn.member.ID, DocumentLevelView, w.tn.aclOwner.ID)
	w.f.arLink(t, d, w.tn.aclOwner.ID, expiry)
	w.f.arLink(t, d, w.tn.aclOwner.ID, time.Now().Add(-time.Hour)) // expired: no row
	grant := w.f.arBreakGlass(t, d, w.tn.wsAdmin.ID, time.Now().Add(time.Hour), false)
	it := arItem(t, w.f.report(t, w.actor, w.tn.wsA, DocumentAccessReportQuery{}), d.ID)
	if it.LiveLinkCount != 1 {
		t.Fatalf("live_link_count = %d, want 1", it.LiveLinkCount)
	}
	// Order: owner, shares, links, break-glass.
	var sources []string
	for _, r := range it.Rows {
		sources = append(sources, r.Source)
	}
	arSame2(t, "row order", sources, []string{"acl_owner", "share", "link", "break_glass"})
	link := it.Rows[2]
	if link.Via != "link" || link.PrincipalType != "link" || link.PrincipalName != "" || link.Level != "view" ||
		link.EffectiveLevel != "view" || !link.Active || link.GrantedBy != w.tn.aclOwner.ID || link.GrantedByKind != "human" ||
		link.GrantedByName != "aclowner" || link.GrantedAt == nil || link.ExpiresAt == nil || !link.ExpiresAt.Equal(expiry) ||
		link.RevokeKind != "link" || link.RevokeID != link.PrincipalID || link.ShareID != "" || link.Origin != "" {
		t.Fatalf("link row: %+v", link)
	}
	if it.Rows[1].ExpiresAt != nil || it.Rows[3].ExpiresAt != nil || it.Rows[1].RevokeID != sh.ID || it.Rows[3].RevokeID != grant {
		t.Fatalf("share/break-glass rows: %+v %+v", it.Rows[1], it.Rows[3])
	}
}

func TestAccessReportExportAddsExpiresAtLast(t *testing.T) {
	w := newS5World(t, "s5e")
	var buf bytes.Buffer
	if _, err := w.f.svc.ExportDocumentAccessReport(w.f.ctx, w.actor, w.tn.wsA,
		DocumentAccessReportQuery{Flag: "public_link", Q: "hợp đồng"}, AccessReportFormatCSV, &buf); err != nil {
		t.Fatal(err)
	}
	records, err := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(buf.Bytes(), []byte{0xEF, 0xBB, 0xBF}))).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	header := records[0]
	want := []string{
		"document_id", "document_title", "document_path", "document_kind", "visibility", "acl_owner_name", "live_link_count",
		"source", "via", "principal_type", "principal_id", "principal_name", "level", "effective_level", "active",
		"granted_by", "granted_by_name", "granted_at", "report_generated_at", "report_filter", "expires_at",
	}
	arSame2(t, "csv header", header, want)
	var linkLine []string
	for _, rec := range records[1:] {
		if rec[7] == "link" {
			linkLine = rec
		}
	}
	if linkLine == nil || linkLine[len(linkLine)-1] == "" || !strings.Contains(linkLine[19], "q=") {
		t.Fatalf("link line %v; the filter column should carry q= and expires_at last", linkLine)
	}
	for _, rec := range records[1:] {
		if rec[7] != "link" && rec[len(rec)-1] != "" {
			t.Fatalf("a non-link row has an expires_at: %v", rec)
		}
	}
	var audit int
	if err := w.f.pool.QueryRow(w.f.ctx, `SELECT count(*) FROM audit_events WHERE action = 'documents.access_report_exported' AND resource_id = $1
		AND metadata::jsonb->>'flag' = 'public_link' AND metadata::jsonb->>'q' = 'hợp đồng'`, w.tn.wsA).Scan(&audit); err != nil || audit != 1 {
		t.Fatalf("export audit rows with the new filters = %d, %v", audit, err)
	}

	// The workbook has expires_at as its last column too.
	buf.Reset()
	if _, err := w.f.svc.ExportDocumentAccessReport(w.f.ctx, w.actor, w.tn.wsA, DocumentAccessReportQuery{}, AccessReportFormatXLSX, &buf); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(buf.Bytes(), []byte("PK")) {
		t.Fatal("not a workbook")
	}
}

func TestAccessReportSummary(t *testing.T) {
	w := newS5World(t, "s6")
	sum, err := w.f.svc.DocumentAccessReportSummary(w.f.ctx, w.actor, w.tn.wsA, DocumentAccessReportQuery{})
	if err != nil {
		t.Fatal(err)
	}
	// plan has an organization share, so only finance, plain and big are restricted.
	want := DocumentAccessReportTiles{PublicLink: 1, OutsideWorkspace: 2, DirectManage: 1, Documents: 5, Restricted: 3, Workspace: 1, Organization: 1}
	if sum.Tiles != want || sum.MatchingDocuments != 5 || sum.Skipped != 0 || sum.Truncated || sum.GeneratedAt.IsZero() {
		t.Fatalf("summary = %+v", sum)
	}
	// Filters change matching_documents only.
	for _, c := range []struct {
		in    DocumentAccessReportQuery
		match int
	}{
		{DocumentAccessReportQuery{Flag: "public_link"}, 1},
		{DocumentAccessReportQuery{Q: "Plain"}, 1},
		{DocumentAccessReportQuery{Visibility: "restricted"}, 4},
		{DocumentAccessReportQuery{PersonID: util.NewID()}, 0}, // nobody the gates admit
		{DocumentAccessReportQuery{Sources: []string{"chat"}, NonDefault: true}, 1},
	} {
		s, err := w.f.svc.DocumentAccessReportSummary(w.f.ctx, w.actor, w.tn.wsA, c.in)
		if err != nil {
			t.Fatal(err)
		}
		if s.Tiles != want || s.MatchingDocuments != c.match {
			t.Errorf("%+v: tiles=%+v matching=%d, want the same tiles and %d", c.in, s.Tiles, s.MatchingDocuments, c.match)
		}
	}
	// skipped: a manager of one document sees the rest as view-only.
	sum, err = w.f.svc.DocumentAccessReportSummary(w.f.ctx, Human(w.tn.member.ID), w.tn.wsA, DocumentAccessReportQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if sum.Tiles.Documents != 1 || sum.Skipped != 2 {
		t.Fatalf("member summary: %+v (they manage 'finance'; 'contract' and 'plan' they only edit or view)", sum)
	}
	// A cap on the scan reports truncated.
	old := accessReportScanMaxDocs
	accessReportScanMaxDocs = 2
	defer func() { accessReportScanMaxDocs = old }()
	sum, err = w.f.svc.DocumentAccessReportSummary(w.f.ctx, w.actor, w.tn.wsA, DocumentAccessReportQuery{})
	if err != nil || !sum.Truncated || sum.Tiles.Documents != 2 {
		t.Fatalf("capped summary = %+v, %v", sum, err)
	}
	// Refusals are the page's.
	if _, err := w.f.svc.DocumentAccessReportSummary(w.f.ctx, agentActor(w.tn.agent), w.tn.wsA, DocumentAccessReportQuery{}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("agent: %v", err)
	}
}

func TestAccessReportPrincipals(t *testing.T) {
	w := newS5World(t, "s7")
	res, err := w.f.svc.DocumentAccessReportPrincipals(w.f.ctx, w.actor, w.tn.wsA, DocumentAccessReportPrincipalsQuery{})
	if err != nil {
		t.Fatal(err)
	}
	by := map[string]DocumentAccessReportPrincipal{}
	var order []string
	for _, p := range res.Principals {
		by[p.PrincipalType+":"+p.PrincipalID] = p
		order = append(order, p.Kind)
	}
	// The ACL owner holds manage on all 5 (owner source); the home workspace has a
	// row on the workspace-visible document; the member is on 2 documents, ...
	owner := by["user:"+w.tn.aclOwner.ID]
	if owner.Kind != "member" || owner.DocumentCount != 5 || owner.Levels["manage"] != 5 || owner.MainSource != "owner" || owner.MemberCount != nil {
		t.Fatalf("owner: %+v", owner)
	}
	member := by["user:"+w.tn.member.ID]
	if member.DocumentCount != 2 || member.Levels["view"] != 1 || member.Levels["manage"] != 1 || member.MainSource != "direct" {
		t.Fatalf("member: %+v", member)
	}
	home := by["workspace:"+w.tn.wsA]
	if home.Kind != "home_workspace" || home.DocumentCount != 1 || home.MainSource != "workspace" || home.MemberCount == nil || *home.MemberCount < 1 {
		t.Fatalf("home workspace: %+v (%v)", home, home.MemberCount)
	}
	other := by["workspace:"+w.tn.wsB]
	if other.Kind != "other_workspace" || other.Levels["edit"] != 1 || other.MemberCount == nil {
		t.Fatalf("other workspace: %+v", other)
	}
	org := by["organization:"+w.tn.orgID]
	if org.Kind != "organization" || org.DocumentCount != 1 || org.Levels["view"] != 1 || org.MemberCount == nil || *org.MemberCount < 5 {
		t.Fatalf("organization: %+v", org)
	}
	link := by["link:"]
	if link.Kind != "link" || link.PrincipalID != "" || link.DocumentCount != 1 || link.MainSource != "link" || link.Levels["view"] != 1 {
		t.Fatalf("link: %+v", link)
	}
	chat := by["user:"+w.tn.creator.ID]
	if chat.MainSource != "chat" || chat.Levels["comment"] != 1 {
		t.Fatalf("chat recipient: %+v", chat)
	}
	// Default order: document count, descending; the ACL owner leads.
	if res.Principals[0].PrincipalID != w.tn.aclOwner.ID {
		t.Fatalf("first principal = %+v", res.Principals[0])
	}
	for i := 1; i < len(res.Principals); i++ {
		if res.Principals[i-1].DocumentCount < res.Principals[i].DocumentCount {
			t.Fatalf("count order broken at %d: %v", i, order)
		}
	}
	if res.Truncated || res.GeneratedAt.IsZero() {
		t.Fatalf("truncated=%v generated=%v", res.Truncated, res.GeneratedAt)
	}

	// kind, q, level, sort.
	res, _ = w.f.svc.DocumentAccessReportPrincipals(w.f.ctx, w.actor, w.tn.wsA, DocumentAccessReportPrincipalsQuery{Kind: "other_workspace"})
	if len(res.Principals) != 1 || res.Principals[0].PrincipalID != w.tn.wsB {
		t.Fatalf("kind filter: %+v", res.Principals)
	}
	res, _ = w.f.svc.DocumentAccessReportPrincipals(w.f.ctx, w.actor, w.tn.wsA, DocumentAccessReportPrincipalsQuery{Q: "MEMBER"})
	if len(res.Principals) != 1 || res.Principals[0].PrincipalID != w.tn.member.ID {
		t.Fatalf("q filter: %+v", res.Principals)
	}
	res, _ = w.f.svc.DocumentAccessReportPrincipals(w.f.ctx, w.actor, w.tn.wsA, DocumentAccessReportPrincipalsQuery{Kind: "member", Levels: []string{"manage"}, Sort: "name"})
	var names []string
	for _, p := range res.Principals {
		names = append(names, p.PrincipalName)
		if p.Levels["manage"] != p.DocumentCount {
			t.Errorf("level filter leaked a non-manage row: %+v", p)
		}
	}
	arSame2(t, "name order", names, []string{"aclowner", "member"})
	res, _ = w.f.svc.DocumentAccessReportPrincipals(w.f.ctx, w.actor, w.tn.wsA, DocumentAccessReportPrincipalsQuery{Kind: "member", Sort: "name", Order: "desc"})
	if res.Principals[0].PrincipalName < res.Principals[len(res.Principals)-1].PrincipalName {
		t.Fatalf("name desc: %+v", res.Principals)
	}
	for _, in := range []DocumentAccessReportPrincipalsQuery{{Kind: "bot"}, {Sort: "x"}, {Order: "x"}, {Levels: []string{"owner"}}, {Q: strings.Repeat("a", 101)}} {
		if _, err := w.f.svc.DocumentAccessReportPrincipals(w.f.ctx, w.actor, w.tn.wsA, in); err == nil {
			t.Errorf("%+v accepted", in)
		}
	}
}

func TestAccessReportMainSourceTieBreak(t *testing.T) {
	for _, c := range []struct {
		counts map[string]int
		want   string
	}{
		{map[string]int{"owner": 2, "workspace": 2, "link": 2, "chat": 2, "direct": 2}, "direct"},
		{map[string]int{"owner": 2, "workspace": 2, "link": 2, "chat": 2}, "chat"},
		{map[string]int{"owner": 2, "workspace": 2, "link": 2}, "link"},
		{map[string]int{"owner": 2, "workspace": 2}, "workspace"},
		{map[string]int{"owner": 1, "break_glass": 1}, "owner"},
		{map[string]int{"direct": 1, "owner": 3}, "owner"},
	} {
		if got := mainSource(c.counts); got != c.want {
			t.Errorf("%v: %q, want %q", c.counts, got, c.want)
		}
	}
}

func TestAccessReportPrincipalsAreTruncatedAtTheCap(t *testing.T) {
	w := newS5World(t, "s7t")
	// Five principals or more exist; a cap of 3 would cut the list. The cap
	// is a const, so prove the scan-level truncation instead.
	old := accessReportScanMaxDocs
	accessReportScanMaxDocs = 1
	defer func() { accessReportScanMaxDocs = old }()
	res, err := w.f.svc.DocumentAccessReportPrincipals(w.f.ctx, w.actor, w.tn.wsA, DocumentAccessReportPrincipalsQuery{})
	if err != nil || !res.Truncated {
		t.Fatalf("truncated=%v err=%v", res.Truncated, err)
	}
}
