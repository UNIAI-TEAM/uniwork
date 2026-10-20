package service

import (
	"errors"
	"strings"
	"testing"
	"time"
)

// The access report redesign (UNI-2039): S1 document facts and revoke
// targets, S4 sorting and full pages. Contract:
// ~/office-g5g6g7/reports/e6-server/contract-uni2039-access-report.md §3.

// arSetCreated stamps documents.created_at, the base of access_changed_at.
func (f *docPermFixture) arSetCreated(t *testing.T, id string, at time.Time) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET created_at = $2 WHERE id = $1`, id, at); err != nil {
		t.Fatal(err)
	}
}

func arSame2(t *testing.T, label string, got, want []string) {
	t.Helper()
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("%s: got %v want %v", label, got, want)
	}
}

func TestAccessReportDocumentFactsGeneralScopeAndFlags(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "s1a")
	owner := Human(tn.owner.ID)

	restricted := f.arDoc(t, tn, arDocSpec{visibility: "restricted", aclOwner: tn.aclOwner.ID})
	workspace := f.arDoc(t, tn, arDocSpec{visibility: "workspace", aclOwner: tn.aclOwner.ID})
	org := f.arDoc(t, tn, arDocSpec{visibility: "restricted", aclOwner: tn.aclOwner.ID})
	f.share(t, org, DocumentPrincipalOrganization, tn.orgID, DocumentLevelComment, tn.aclOwner.ID)
	// An organization share wins over workspace visibility.
	orgAndWS := f.arDoc(t, tn, arDocSpec{visibility: "workspace", aclOwner: tn.aclOwner.ID})
	f.share(t, orgAndWS, DocumentPrincipalOrganization, tn.orgID, DocumentLevelView, tn.aclOwner.ID)
	other := f.arDoc(t, tn, arDocSpec{visibility: "restricted", aclOwner: tn.aclOwner.ID})
	f.share(t, other, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelView, tn.aclOwner.ID)
	home := f.arDoc(t, tn, arDocSpec{visibility: "restricted", aclOwner: tn.aclOwner.ID})
	f.share(t, home, DocumentPrincipalWorkspace, tn.wsA, DocumentLevelView, tn.aclOwner.ID)
	link := f.arDoc(t, tn, arDocSpec{visibility: "restricted", aclOwner: tn.aclOwner.ID})
	f.arLink(t, link, tn.aclOwner.ID, time.Now().Add(time.Hour))
	expiredLink := f.arDoc(t, tn, arDocSpec{visibility: "restricted", aclOwner: tn.aclOwner.ID})
	f.arLink(t, expiredLink, tn.aclOwner.ID, time.Now().Add(-time.Hour))
	manage := f.arDoc(t, tn, arDocSpec{visibility: "restricted", aclOwner: tn.aclOwner.ID})
	f.share(t, manage, DocumentPrincipalUser, tn.member.ID, DocumentLevelManage, tn.aclOwner.ID)
	ownerManage := f.arDoc(t, tn, arDocSpec{visibility: "restricted", aclOwner: tn.aclOwner.ID})
	f.share(t, ownerManage, DocumentPrincipalUser, tn.aclOwner.ID, DocumentLevelManage, tn.owner.ID)
	revoked := f.arDoc(t, tn, arDocSpec{visibility: "restricted", aclOwner: tn.aclOwner.ID})
	f.revoke(t, f.share(t, revoked, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelManage, tn.aclOwner.ID), tn.owner.ID)

	page := f.report(t, owner, tn.wsA, DocumentAccessReportQuery{})
	for _, c := range []struct {
		name         string
		id           string
		scope, level string
		flags        string
	}{
		{"restricted", restricted.ID, "restricted", "", ""},
		{"workspace", workspace.ID, "workspace", "edit", ""},
		{"organization", org.ID, "organization", "comment", "organization"},
		{"organization beats workspace", orgAndWS.ID, "organization", "view", "organization"},
		{"other workspace", other.ID, "restricted", "", "other_workspace"},
		{"home workspace share is not outside", home.ID, "restricted", "", ""},
		{"live link", link.ID, "restricted", "", "public_link"},
		{"expired link", expiredLink.ID, "restricted", "", ""},
		{"direct manage", manage.ID, "restricted", "", "direct_manage"},
		{"manage to the ACL owner", ownerManage.ID, "restricted", "", ""},
		{"revoked share carries no flag", revoked.ID, "restricted", "", ""},
	} {
		it := arItem(t, page, c.id)
		if it.GeneralScope != c.scope || it.GeneralLevel != c.level || strings.Join(it.Flags, ",") != c.flags {
			t.Errorf("%s: scope=%q/%q flags=%v, want %q/%q %q", c.name, it.GeneralScope, it.GeneralLevel, it.Flags, c.scope, c.level, c.flags)
		}
	}

	// Several flags at once keep the contract's order.
	many := f.arDoc(t, tn, arDocSpec{visibility: "restricted", aclOwner: tn.aclOwner.ID})
	f.arLink(t, many, tn.aclOwner.ID, time.Now().Add(time.Hour))
	f.share(t, many, DocumentPrincipalWorkspace, tn.wsB, DocumentLevelManage, tn.aclOwner.ID)
	f.share(t, many, DocumentPrincipalOrganization, tn.orgID, DocumentLevelView, tn.aclOwner.ID)
	got := arItem(t, f.report(t, owner, tn.wsA, DocumentAccessReportQuery{}), many.ID).Flags
	arSame2(t, "flag order", got, []string{"public_link", "other_workspace", "organization", "direct_manage"})
}

func TestAccessReportAccessChangedAtIsTheLatestOfEverySource(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "s1b")
	owner := Human(tn.owner.ID)
	base := time.Now().UTC().Truncate(time.Second).Add(-240 * time.Hour)
	d := f.arDoc(t, tn, arDocSpec{visibility: "restricted", aclOwner: tn.aclOwner.ID})
	f.arSetCreated(t, d.ID, base)
	sh := f.share(t, d, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)
	revokedSh := f.share(t, d, DocumentPrincipalUser, tn.creator.ID, DocumentLevelView, tn.aclOwner.ID)
	f.revoke(t, revokedSh, tn.owner.ID)
	f.arLink(t, d, tn.aclOwner.ID, time.Now().Add(time.Hour))
	f.arLink(t, d, tn.aclOwner.ID, time.Now().Add(time.Hour))
	grant := f.arBreakGlass(t, d, tn.wsAdmin.ID, time.Now().Add(time.Hour), false)
	// Park every source in the past, below the next stamp under test.
	for _, q := range []string{
		`UPDATE document_shares SET created_at = $2, revoked_at = CASE WHEN revoked_at IS NULL THEN NULL ELSE $2::timestamptz END WHERE document_id = $1`,
		`UPDATE document_share_links SET created_at = $2 WHERE document_id = $1`,
		`UPDATE document_break_glass_grants SET granted_at = $2 WHERE document_id = $1`,
	} {
		if _, err := f.pool.Exec(f.ctx, q, d.ID, base.Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	changed := func() time.Time {
		return arItem(t, f.report(t, owner, tn.wsA, DocumentAccessReportQuery{}), d.ID).AccessChangedAt
	}
	if got, want := changed(), base.Add(time.Hour); !got.Equal(want) {
		t.Fatalf("latest of the parked sources = %s, want %s", got, want)
	}
	for i, c := range []struct{ name, q string }{
		{"documents.created_at", `UPDATE documents SET created_at = $2 WHERE id = $1`},
		{"document_shares.created_at", `UPDATE document_shares SET created_at = $2 WHERE id = '` + sh.ID + `' AND $1 = $1`},
		{"document_shares.revoked_at", `UPDATE document_shares SET revoked_at = $2 WHERE id = '` + revokedSh.ID + `' AND $1 = $1`},
		{"document_share_links.created_at", `UPDATE document_share_links SET created_at = $2 WHERE document_id = $1 AND id = (SELECT min(id) FROM document_share_links WHERE document_id = $1)`},
		{"document_share_links.revoked_at", `UPDATE document_share_links SET revoked_at = $2, revoked_by = 'x' WHERE document_id = $1 AND id = (SELECT max(id) FROM document_share_links WHERE document_id = $1)`},
		{"document_break_glass_grants.granted_at", `UPDATE document_break_glass_grants SET granted_at = $2 WHERE id = '` + grant + `' AND $1 = $1`},
	} {
		at := base.Add(time.Duration(10+i) * time.Hour)
		if _, err := f.pool.Exec(f.ctx, c.q, d.ID, at); err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if got := changed(); !got.Equal(at) {
			t.Errorf("%s: access_changed_at = %s, want %s", c.name, got, at)
		}
	}
}

func TestAccessReportCallerLevelAndAdminScope(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "s1c")
	d := f.arDoc(t, tn, arDocSpec{visibility: "restricted", aclOwner: tn.aclOwner.ID})
	it := arItem(t, f.report(t, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{}), d.ID)
	if !it.Item.Access.AdminScope || it.Item.Access.Level != DocumentLevelNone {
		t.Fatalf("org owner on a restricted document: %+v", it.Item.Access)
	}
	it = arItem(t, f.report(t, Human(tn.aclOwner.ID), tn.wsA, DocumentAccessReportQuery{}), d.ID)
	if it.Item.Access.AdminScope || it.Item.Access.Level != DocumentLevelManage {
		t.Fatalf("ACL owner: %+v", it.Item.Access)
	}
}

func TestAccessReportRevokeTargetMirrorsTheRevokeGates(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "s1d")
	d := f.arDoc(t, tn, arDocSpec{visibility: "workspace", aclOwner: tn.aclOwner.ID})
	sh := f.share(t, d, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)
	grant := f.arBreakGlass(t, d, tn.wsAdmin.ID, time.Now().Add(time.Hour), false)

	// The organization owner administers a restricted document through
	// AdminScope alone; the same gates give them the same targets.
	rd := f.arDoc(t, tn, arDocSpec{visibility: "restricted", aclOwner: tn.aclOwner.ID})
	rsh := f.share(t, rd, DocumentPrincipalUser, tn.member.ID, DocumentLevelView, tn.aclOwner.ID)
	adminPage := f.report(t, Human(tn.owner.ID), tn.wsA, DocumentAccessReportQuery{})
	for _, r := range arItem(t, adminPage, rd.ID).Rows {
		if r.Source == AccessReportSourceShare && (r.RevokeKind != "share" || r.RevokeID != rsh.ID) {
			t.Errorf("AdminScope caller: share row target = %q:%q", r.RevokeKind, r.RevokeID)
		}
	}
	for _, actor := range []Actor{Human(tn.aclOwner.ID)} {
		it := arItem(t, f.report(t, actor, tn.wsA, DocumentAccessReportQuery{}), d.ID)
		targets := map[string]string{}
		for _, r := range it.Rows {
			targets[r.Source] = r.RevokeKind + ":" + r.RevokeID
		}
		for source, want := range map[string]string{
			AccessReportSourceACLOwner:   ":",
			AccessReportSourceWorkspace:  ":",
			AccessReportSourceShare:      "share:" + sh.ID,
			AccessReportSourceBreakGlass: "break_glass:" + grant,
		} {
			if targets[source] != want {
				t.Errorf("%s: %s revoke target = %q, want %q", actor.ID, source, targets[source], want)
			}
		}
	}

	// UNI-2039 fx1: My Folder is a folder, so it is never a row of the report
	// (TestAccessReportExcludesFoldersAndMyFolder); the revoke targets of its
	// shares are not reachable from here.
}

func TestAccessReportSortValidation(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "s4v")
	for _, in := range []DocumentAccessReportQuery{{Sort: "updated"}, {Order: "up"}, {Sort: "title", Order: "ASC"}} {
		_, err := f.svc.DocumentAccessReport(f.ctx, Human(tn.owner.ID), tn.wsA, in)
		var ve ValidationError
		if !errors.As(err, &ve) {
			t.Errorf("%+v: err = %v, want a validation error", in, err)
		}
	}
}

// arWalk reads every page of a sorted report and returns the ids in order and
// the page count.
func arWalk(t *testing.T, f *docPermFixture, actor Actor, ws string, in DocumentAccessReportQuery) ([]string, int) {
	t.Helper()
	var ids []string
	pages := 0
	for {
		p := f.report(t, actor, ws, in)
		pages++
		ids = append(ids, arIDs(p)...)
		if p.Next == nil {
			return ids, pages
		}
		if pages > 50 {
			t.Fatal("paging does not end")
		}
		in.After = p.Next
	}
}

func TestAccessReportSortByChangedAcrossPagesWithDuplicateKeys(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "s4a")
	owner := Human(tn.owner.ID)
	base := time.Now().UTC().Truncate(time.Second).Add(-100 * time.Hour)
	// Seven documents; four of them share one change time.
	var ids []string
	for i := 0; i < 7; i++ {
		d := f.arDoc(t, tn, arDocSpec{visibility: "restricted"})
		at := base.Add(time.Duration(i) * time.Hour)
		if i >= 2 && i <= 5 {
			at = base.Add(10 * time.Hour)
		}
		f.arSetCreated(t, d.ID, at)
		ids = append(ids, d.ID)
	}
	// Expected: by change time, ties by id ascending.
	order := func(desc bool) []string {
		type kv struct {
			id string
			at int
		}
		keys := map[string]int{ids[0]: 0, ids[1]: 1, ids[2]: 10, ids[3]: 10, ids[4]: 10, ids[5]: 10, ids[6]: 6}
		out := arSorted(ids...)
		sorted := make([]kv, 0, len(out))
		for _, id := range out {
			sorted = append(sorted, kv{id, keys[id]})
		}
		for i := 1; i < len(sorted); i++ {
			for j := i; j > 0; j-- {
				a, b := sorted[j-1], sorted[j]
				if (desc && a.at < b.at) || (!desc && a.at > b.at) {
					sorted[j-1], sorted[j] = b, a
				}
			}
		}
		res := make([]string, len(sorted))
		for i, s := range sorted {
			res[i] = s.id
		}
		return res
	}
	for _, c := range []struct {
		name string
		in   DocumentAccessReportQuery
		desc bool
	}{
		{"default is newest first", DocumentAccessReportQuery{Limit: 3}, true},
		{"changed desc", DocumentAccessReportQuery{Sort: "changed", Order: "desc", Limit: 3}, true},
		{"changed asc", DocumentAccessReportQuery{Sort: "changed", Order: "asc", Limit: 3}, false},
	} {
		got, pages := arWalk(t, f, owner, tn.wsA, c.in)
		arSame2(t, c.name, got, order(c.desc))
		if pages != 3 {
			t.Errorf("%s: %d pages, want 3", c.name, pages)
		}
	}
}

func TestAccessReportSortByTitleUsesTheViCollation(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "s4b")
	owner := Human(tn.owner.ID)
	titles := []string{"bravo", "Alpha", "Đông", "charlie", "Delta", "Same", "Same", "Same", "Ăn"}
	byTitle := map[string][]string{}
	for _, title := range titles {
		d := f.arDoc(t, tn, arDocSpec{visibility: "restricted", title: title})
		byTitle[title] = append(byTitle[title], d.ID)
	}
	for _, v := range byTitle {
		// Duplicates are tied by id ascending.
		for i := 1; i < len(v); i++ {
			if v[i-1] > v[i] {
				v[i-1], v[i] = v[i], v[i-1]
			}
		}
	}
	collate := func(title string) string { // the vi-x-icu order of the titles under test
		return map[string]string{"Alpha": "1", "Ăn": "2", "bravo": "3", "charlie": "4", "Delta": "5", "Đông": "6", "Same": "7"}[title]
	}
	var distinct []string
	for title := range byTitle {
		distinct = append(distinct, title)
	}
	for i := 1; i < len(distinct); i++ {
		for j := i; j > 0 && collate(distinct[j-1]) > collate(distinct[j]); j-- {
			distinct[j-1], distinct[j] = distinct[j], distinct[j-1]
		}
	}
	var asc, desc []string
	for _, title := range distinct {
		asc = append(asc, byTitle[title]...)
	}
	for i := len(distinct) - 1; i >= 0; i-- {
		desc = append(desc, byTitle[distinct[i]]...)
	}
	got, pages := arWalk(t, f, owner, tn.wsA, DocumentAccessReportQuery{Sort: "title", Limit: 2})
	arSame2(t, "title defaults to A-Z", got, asc)
	if pages != 5 {
		t.Errorf("title asc: %d pages, want 5", pages)
	}
	got, _ = arWalk(t, f, owner, tn.wsA, DocumentAccessReportQuery{Sort: "title", Order: "desc", Limit: 2})
	arSame2(t, "title desc", got, desc)
}

// A workspace where most candidates are only viewable by the caller still
// fills pages (S4): the server keeps reading until limit documents are
// listable or 10 x limit candidates were scanned.
func TestAccessReportPagesAreFullEvenWhenMostCandidatesAreViewOnly(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "s4c")
	member := Human(tn.member.ID)
	base := time.Now().UTC().Truncate(time.Second).Add(-500 * time.Hour)
	n := 0
	mk := func(managed bool) string {
		spec := arDocSpec{visibility: "workspace"} // edit for the member: listed only when managed
		if managed {
			spec.aclOwner = tn.member.ID
		}
		d := f.arDoc(t, tn, spec)
		n++
		f.arSetCreated(t, d.ID, base.Add(time.Duration(n)*time.Minute))
		return d.ID
	}
	// Oldest to newest: 3 managed, 25 view-only, 3 managed. The default order
	// is newest first, so the page meets 3 managed, then the view-only run.
	var managed []string
	for i := 0; i < 3; i++ {
		managed = append(managed, mk(true))
	}
	for i := 0; i < 25; i++ {
		mk(false)
	}
	for i := 0; i < 3; i++ {
		managed = append(managed, mk(true))
	}
	p := f.report(t, member, tn.wsA, DocumentAccessReportQuery{Limit: 4})
	if len(p.Items) != 4 || p.Next == nil {
		t.Fatalf("first page: %d items, next %v", len(p.Items), p.Next)
	}
	if p.Skipped != 25 || p.Candidates != 4+25 {
		t.Fatalf("first page read %d candidates and skipped %d, want 29 and 25", p.Candidates, p.Skipped)
	}
	p2 := f.report(t, member, tn.wsA, DocumentAccessReportQuery{Limit: 4, After: p.Next})
	if len(p2.Items) != 2 || p2.Next != nil {
		t.Fatalf("second page: %d items, next %v", len(p2.Items), p2.Next)
	}
	arSame2(t, "all managed documents, once", arSorted(append(arIDs(p), arIDs(p2)...)...), arSorted(managed...))

	// Past 10 x limit candidates the page is short and keeps its cursor.
	g := f.tenant(t, "s4d")
	gm := Human(g.member.ID)
	for i := 0; i < 31; i++ {
		d := f.arDoc(t, g, arDocSpec{visibility: "workspace"})
		f.arSetCreated(t, d.ID, base.Add(time.Duration(i)*time.Minute))
	}
	last := f.arDoc(t, g, arDocSpec{visibility: "workspace", aclOwner: g.member.ID})
	f.arSetCreated(t, last.ID, base.Add(-time.Hour))
	p = f.report(t, gm, g.wsA, DocumentAccessReportQuery{Limit: 3})
	if len(p.Items) != 0 || p.Next == nil || p.Candidates != 30 || p.Skipped != 30 {
		t.Fatalf("bounded page: items=%d next=%v candidates=%d skipped=%d, want 0 items, a cursor and 30/30", len(p.Items), p.Next, p.Candidates, p.Skipped)
	}
	p = f.report(t, gm, g.wsA, DocumentAccessReportQuery{Limit: 3, After: p.Next})
	arSame2(t, "the page after the bound", arIDs(p), []string{last.ID})
	if p.Next != nil {
		t.Fatalf("the walk ended but a cursor came back: %v", p.Next)
	}
}
