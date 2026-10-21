package service

import (
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-2055 S3 (ADR 0037 point 8): the admin pass that moves every legacy
// private folder that sits outside My Folder into its owner's My Folder. The
// cases are red first; each one is a sentence of the contract (§7, Q5, Q8).

type fimFixture struct {
	f  *docPermFixture
	tn docTenant
}

func newFimFixture(t *testing.T, slug string) *fimFixture {
	t.Helper()
	f := newDocPermFixture(t)
	return &fimFixture{f: f, tn: f.tenant(t, slug)}
}

// folder creates a restricted folder through the service as owner (the way a
// folder was made before the pass), under parentID ("" = workspace root).
func (x *fimFixture) folder(t *testing.T, owner db.User, title, parentID string) db.Document {
	t.Helper()
	v, err := x.f.svc.CreatePage(x.f.ctx, Human(owner.ID), x.tn.wsA, CreatePageInput{Kind: DocumentKindFolder, Title: title, ParentID: parentID})
	if err != nil {
		t.Fatalf("folder %q: %v", title, err)
	}
	return v.Document
}

func (x *fimFixture) page(t *testing.T, owner db.User, title, parentID, visibility string) db.Document {
	t.Helper()
	v, err := x.f.svc.CreatePage(x.f.ctx, Human(owner.ID), x.tn.wsA, CreatePageInput{Title: title, ParentID: parentID, Visibility: visibility})
	if err != nil {
		t.Fatalf("page %q: %v", title, err)
	}
	return v.Document
}

// put places a row under parentID and hands it to owner, the way an old mixed
// tree looked (one person's row inside another person's folder).
func (x *fimFixture) put(t *testing.T, id, parentID string, owner db.User) {
	t.Helper()
	if _, err := x.f.pool.Exec(x.f.ctx,
		`UPDATE documents SET parent_id = NULLIF($2, ''), acl_owner_id = $3, created_by = $3 WHERE id = $1`,
		id, parentID, owner.ID); err != nil {
		t.Fatal(err)
	}
}

func (x *fimFixture) get(t *testing.T, id string) db.Document {
	t.Helper()
	d, err := x.f.q.GetDocumentByID(x.f.ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func (x *fimFixture) myFolder(t *testing.T, u db.User) db.Document {
	t.Helper()
	d, err := x.f.q.GetMyFolder(x.f.ctx, db.GetMyFolderParams{
		OrganizationID: x.tn.orgID, WorkspaceID: x.tn.wsA, AclOwnerID: pgtype.Text{String: u.ID, Valid: true},
	})
	if err != nil {
		t.Fatalf("My Folder of %s: %v", u.ID, err)
	}
	return d
}

func (x *fimFixture) noMyFolder(t *testing.T, u db.User) bool {
	t.Helper()
	return x.count(t, `SELECT count(*) FROM documents WHERE workspace_id = $1 AND acl_owner_id = $2 AND system_kind = 'my_folder'`, x.tn.wsA, u.ID) == 0
}

func (x *fimFixture) count(t *testing.T, query string, args ...any) int {
	t.Helper()
	var n int
	if err := x.f.pool.QueryRow(x.f.ctx, query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (x *fimFixture) hash(t *testing.T, id string) string {
	t.Helper()
	var h string
	if err := x.f.pool.QueryRow(x.f.ctx, `SELECT md5(d::text) FROM documents d WHERE id = $1`, id).Scan(&h); err != nil {
		t.Fatal(err)
	}
	return h
}

func (x *fimFixture) run(t *testing.T, dry bool, org string) FoldersIntoMyFolderReport {
	t.Helper()
	res, err := x.f.svc.MoveFoldersIntoMyFolder(x.f.ctx, dry, 2, org)
	if err != nil {
		t.Fatalf("MoveFoldersIntoMyFolder(dry=%v): %v", dry, err)
	}
	return res
}

// moveRows is how many document.moved audit rows and outbox frames the pass
// left on this id.
func (x *fimFixture) moveRows(t *testing.T, id string) (auditRows, frames int) {
	t.Helper()
	return x.count(t, `SELECT count(*) FROM audit_events WHERE action = 'document.moved' AND resource_id = $1 AND actor_id = 'folder-ws-public'`, id),
		x.count(t, `SELECT count(*) FROM outbox_events WHERE topic = 'document.moved' AND payload::jsonb->>'document_id' = $1`, id)
}

func (x *fimFixture) passRows(t *testing.T) int {
	t.Helper()
	return x.count(t, `SELECT count(*) FROM audit_events WHERE actor_id = 'folder-ws-public' AND organization_id = $1`, x.tn.orgID)
}

func TestFoldersIntoMyFolderMovesRootFolderKeepsAccess(t *testing.T) {
	x := newFimFixture(t, "fim1")
	a := x.tn.member
	root := x.folder(t, a, "Dự án", "")
	open := x.page(t, a, "Trang mở", root.ID, documentVisibilityWorkspace)
	closed := x.page(t, a, "Trang riêng", root.ID, "")
	openBefore, closedBefore := x.hash(t, open.ID), x.hash(t, closed.ID)

	res := x.run(t, false, x.tn.orgID)
	if res.DryRun || res.Units != 1 || res.MovedFolders != 1 || res.RelocatedDocuments != 0 || len(res.Skipped) != 0 {
		t.Fatalf("report = %+v, want one unit moved", res)
	}
	mf := x.myFolder(t, a)
	got := x.get(t, root.ID)
	if !got.ParentID.Valid || got.ParentID.String != mf.ID {
		t.Fatalf("folder parent = %+v, want A's My Folder %s", got.ParentID, mf.ID)
	}
	if got.Visibility != documentVisibilityRestricted || got.Title != "Dự án" || got.Revision != root.Revision+1 {
		t.Fatalf("folder after = visibility %q title %q revision %d", got.Visibility, got.Title, got.Revision)
	}
	if x.hash(t, open.ID) != openBefore || x.hash(t, closed.ID) != closedBefore {
		t.Fatal("a document inside the folder was written; they must keep their own access untouched")
	}
	if p := x.get(t, open.ID).ParentID; !p.Valid || p.String != root.ID {
		t.Fatal("the document left its folder")
	}
}

func TestFoldersIntoMyFolderAuditsAndEmitsEachMovedRow(t *testing.T) {
	x := newFimFixture(t, "fim2")
	a := x.tn.member
	root := x.folder(t, a, "Có audit", "")

	x.run(t, false, x.tn.orgID)
	var kind, actor, meta string
	if err := x.f.pool.QueryRow(x.f.ctx,
		`SELECT actor_kind, actor_id, metadata FROM audit_events WHERE action = 'document.moved' AND resource_id = $1 AND actor_id = 'folder-ws-public'`,
		root.ID).Scan(&kind, &actor, &meta); err != nil {
		t.Fatalf("audit row: %v", err)
	}
	if kind != "system" || actor != "folder-ws-public" {
		t.Fatalf("actor = %s/%s, want system/folder-ws-public", kind, actor)
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(meta), &m); err != nil {
		t.Fatal(err)
	}
	if m["reason"] != "folders_into_my_folder" {
		t.Fatalf("metadata.reason = %v, want folders_into_my_folder (never folder_trashed)", m["reason"])
	}
	if b, _ := m["batch_id"].(string); b == "" {
		t.Fatalf("metadata.batch_id missing: %v", m)
	}
	if n := x.count(t, `SELECT count(*) FROM audit_events WHERE resource_id = $1 AND metadata::jsonb->>'reason' = 'folder_trashed'`, root.ID); n != 0 {
		t.Fatal("a folder_trashed reason was written")
	}
	if _, frames := x.moveRows(t, root.ID); frames != 1 {
		t.Fatalf("outbox document.moved frames = %d, want 1", frames)
	}
	var payload string
	if err := x.f.pool.QueryRow(x.f.ctx,
		`SELECT payload::text FROM outbox_events WHERE topic = 'document.moved' AND payload::jsonb->>'document_id' = $1`, root.ID).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	var p map[string]any
	if err := json.Unmarshal([]byte(payload), &p); err != nil || len(p) != 2 || p["workspace_id"] != x.tn.wsA {
		t.Fatalf("outbox payload = %s, want ids only (document_id, workspace_id)", payload)
	}
}

// The move allocator numbers a clash from (2) (FD-D5: "A", "A (2)"), so the
// folder that finds the name taken in My Folder becomes "Báo cáo (2)".
func TestFoldersIntoMyFolderNameClashGetsNumber(t *testing.T) {
	x := newFimFixture(t, "fim3")
	a := x.tn.member
	mfView, _, err := x.f.svc.EnsureMyFolder(x.f.ctx, Human(a.ID), x.tn.wsA)
	if err != nil {
		t.Fatal(err)
	}
	x.folder(t, a, "Báo cáo", mfView.Document.ID)
	root := x.folder(t, a, "Báo cáo", "")

	res := x.run(t, false, x.tn.orgID)
	if res.MovedFolders != 1 {
		t.Fatalf("report = %+v", res)
	}
	got := x.get(t, root.ID)
	if got.Title != "Báo cáo (2)" || got.ParentID.String != mfView.Document.ID {
		t.Fatalf("folder = %q under %v, want \"Báo cáo (2)\" in My Folder", got.Title, got.ParentID)
	}
}

func TestFoldersIntoMyFolderSplitsMixedTreeByOwner(t *testing.T) {
	x := newFimFixture(t, "fim4")
	a, b := x.tn.member, x.tn.creator
	fa := x.folder(t, a, "Cây của A", "")
	ownPage := x.page(t, a, "Trang của A", fa.ID, "")
	sb := x.folder(t, a, "Thư mục con của B", fa.ID)
	aInSB := x.page(t, a, "Trang của A trong thư mục B", sb.ID, "")
	pb := x.page(t, a, "Trang của B", fa.ID, documentVisibilityWorkspace)
	pbChild := x.page(t, a, "Con của trang B", pb.ID, "")
	x.put(t, sb.ID, fa.ID, b)
	x.put(t, pb.ID, fa.ID, b)
	x.put(t, pbChild.ID, pb.ID, b)
	pbBefore := x.get(t, pb.ID)

	res := x.run(t, false, x.tn.orgID)
	if res.Units != 2 || res.MovedFolders != 2 || res.RelocatedDocuments != 2 || len(res.Skipped) != 0 {
		t.Fatalf("report = %+v, want 2 units (A's tree, B's sub-folder) and 2 relocated documents (B's page, A's page in B's folder)", res)
	}
	mfA, mfB := x.myFolder(t, a), x.myFolder(t, b)
	if p := x.get(t, fa.ID).ParentID; p.String != mfA.ID {
		t.Fatalf("A's folder parent = %v, want A's My Folder", p)
	}
	if p := x.get(t, sb.ID).ParentID; p.String != mfB.ID {
		t.Fatalf("B's sub-folder parent = %v, want B's My Folder", p)
	}
	if p := x.get(t, ownPage.ID).ParentID; p.String != fa.ID {
		t.Fatalf("A's own page left A's folder: %v", p)
	}
	for name, id := range map[string]string{"B's page": pb.ID, "A's page in B's folder": aInSB.ID} {
		if x.get(t, id).ParentID.Valid {
			t.Fatalf("%s is not at the workspace root", name)
		}
	}
	pbAfter := x.get(t, pb.ID)
	if pbAfter.Visibility != pbBefore.Visibility || pbAfter.WorkspaceLevel != pbBefore.WorkspaceLevel || pbAfter.Title != pbBefore.Title {
		t.Fatalf("B's page access changed: %+v -> %+v", pbBefore, pbAfter)
	}
	if p := x.get(t, pbChild.ID).ParentID; p.String != pb.ID {
		t.Fatal("the subtree of a relocated page did not go with it")
	}
	for _, id := range []string{fa.ID, sb.ID, pb.ID, aInSB.ID} {
		if rows, frames := x.moveRows(t, id); rows != 1 || frames != 1 {
			t.Fatalf("%s: audit rows %d, outbox frames %d, want one each", id, rows, frames)
		}
	}
	batches := x.count(t, `SELECT count(DISTINCT metadata::jsonb->>'batch_id') FROM audit_events WHERE actor_id = 'folder-ws-public' AND action = 'document.moved' AND organization_id = $1`, x.tn.orgID)
	if batches != 1 {
		t.Fatalf("batch ids in one pass = %d, want 1", batches)
	}
}

func TestFoldersIntoMyFolderPublicSubFolderStaysPublicAtRoot(t *testing.T) {
	x := newFimFixture(t, "fim5")
	a, b := x.tn.member, x.tn.creator
	fa := x.folder(t, a, "Cũ của A", "")
	pub := x.folder(t, a, "Chung của B", fa.ID)
	x.put(t, pub.ID, fa.ID, b)
	if _, err := x.f.pool.Exec(x.f.ctx, `UPDATE documents SET visibility = 'workspace', workspace_level = 'view' WHERE id = $1`, pub.ID); err != nil {
		t.Fatal(err)
	}
	rootPublic := x.folder(t, b, "Chung ở gốc", "")
	if _, err := x.f.pool.Exec(x.f.ctx, `UPDATE documents SET visibility = 'workspace', workspace_level = 'view' WHERE id = $1`, rootPublic.ID); err != nil {
		t.Fatal(err)
	}
	rootPublicBefore := x.hash(t, rootPublic.ID)

	res := x.run(t, false, x.tn.orgID)
	if res.Units != 1 || res.RelocatedPublicFolders != 1 {
		t.Fatalf("report = %+v, want one unit and one public folder relocated", res)
	}
	got := x.get(t, pub.ID)
	if got.ParentID.Valid || got.Visibility != documentVisibilityWorkspace {
		t.Fatalf("public sub-folder = parent %v visibility %q, want the workspace root and still workspace", got.ParentID, got.Visibility)
	}
	if x.hash(t, rootPublic.ID) != rootPublicBefore {
		t.Fatal("a workspace folder outside My Folder was touched: after ADR 0037 it is public on purpose")
	}
	if !x.noMyFolder(t, b) {
		t.Fatal("B got a My Folder although none of B's folders is private")
	}
}

func TestFoldersIntoMyFolderDeactivatedOwnerGetsMyFolder(t *testing.T) {
	x := newFimFixture(t, "fim6")
	d := x.tn.deact
	root := x.folder(t, x.tn.member, "Của người đã nghỉ", "")
	x.put(t, root.ID, "", d)
	if !x.noMyFolder(t, d) {
		t.Fatal("setup: the deactivated member already has a My Folder")
	}

	res := x.run(t, false, x.tn.orgID)
	if res.MovedFolders != 1 || len(res.Skipped) != 0 {
		t.Fatalf("report = %+v", res)
	}
	mf := x.myFolder(t, d)
	if got := x.get(t, root.ID); got.ParentID.String != mf.ID || got.Visibility != documentVisibilityRestricted {
		t.Fatalf("folder = parent %v visibility %q, want the deactivated owner's My Folder, restricted", got.ParentID, got.Visibility)
	}
}

func TestFoldersIntoMyFolderSkipsFoldersAlreadyInMyFolder(t *testing.T) {
	x := newFimFixture(t, "fim7")
	a := x.tn.member
	mf, _, err := x.f.svc.EnsureMyFolder(x.f.ctx, Human(a.ID), x.tn.wsA)
	if err != nil {
		t.Fatal(err)
	}
	inside := x.folder(t, a, "Đã ở trong", mf.Document.ID)
	deeper := x.folder(t, a, "Sâu hơn", inside.ID)
	before := x.passRows(t)
	hashes := []string{x.hash(t, mf.Document.ID), x.hash(t, inside.ID), x.hash(t, deeper.ID)}

	res := x.run(t, false, x.tn.orgID)
	if res.Units != 0 || res.MovedFolders != 0 || res.RelocatedDocuments != 0 {
		t.Fatalf("report = %+v, want nothing", res)
	}
	for i, id := range []string{mf.Document.ID, inside.ID, deeper.ID} {
		if x.hash(t, id) != hashes[i] {
			t.Fatalf("%s changed", id)
		}
	}
	if x.passRows(t) != before {
		t.Fatal("the pass wrote audit rows for folders already in My Folder")
	}
}

func TestFoldersIntoMyFolderDryRunWritesNothing(t *testing.T) {
	x := newFimFixture(t, "fim8")
	a, b := x.tn.member, x.tn.creator
	fa := x.folder(t, a, "Khô A", "")
	sb := x.folder(t, a, "Khô B", fa.ID)
	x.put(t, sb.ID, fa.ID, b)
	pb := x.page(t, a, "Trang B", fa.ID, "")
	x.put(t, pb.ID, fa.ID, b)
	ids := []string{fa.ID, sb.ID, pb.ID}
	before := map[string]string{}
	for _, id := range ids {
		before[id] = x.hash(t, id)
	}
	docsBefore := x.count(t, `SELECT count(*) FROM documents WHERE organization_id = $1`, x.tn.orgID)
	auditBefore := x.count(t, `SELECT count(*) FROM audit_events WHERE organization_id = $1`, x.tn.orgID)
	outboxBefore := x.count(t, `SELECT count(*) FROM outbox_events WHERE topic = 'document.moved'`)

	res := x.run(t, true, x.tn.orgID)
	if !res.DryRun || res.Units != 2 || res.MovedFolders != 2 || res.RelocatedDocuments != 1 {
		t.Fatalf("dry report = %+v, want 2 units, 2 folders, 1 document", res)
	}
	for _, id := range ids {
		if x.hash(t, id) != before[id] {
			t.Fatalf("a dry run changed %s", id)
		}
	}
	if n := x.count(t, `SELECT count(*) FROM documents WHERE organization_id = $1`, x.tn.orgID); n != docsBefore {
		t.Fatalf("documents %d -> %d: a dry run created a My Folder", docsBefore, n)
	}
	if n := x.count(t, `SELECT count(*) FROM audit_events WHERE organization_id = $1`, x.tn.orgID); n != auditBefore {
		t.Fatal("a dry run wrote audit rows")
	}
	if n := x.count(t, `SELECT count(*) FROM outbox_events WHERE topic = 'document.moved'`); n != outboxBefore {
		t.Fatal("a dry run wrote outbox rows")
	}
}

func TestFoldersIntoMyFolderSecondPassWritesNothing(t *testing.T) {
	x := newFimFixture(t, "fim9")
	a, b := x.tn.member, x.tn.creator
	fa := x.folder(t, a, "Hai lượt A", "")
	sb := x.folder(t, a, "Hai lượt B", fa.ID)
	x.put(t, sb.ID, fa.ID, b)
	pb := x.page(t, a, "Trang B", fa.ID, "")
	x.put(t, pb.ID, fa.ID, b)
	x.folder(t, x.tn.aclOwner, "Gốc khác", "")

	first := x.run(t, false, x.tn.orgID)
	if first.Units != 3 {
		t.Fatalf("first pass = %+v, want 3 units", first)
	}
	auditAfter := x.count(t, `SELECT count(*) FROM audit_events WHERE organization_id = $1`, x.tn.orgID)
	outboxAfter := x.count(t, `SELECT count(*) FROM outbox_events WHERE topic = 'document.moved'`)
	docHash := map[string]string{}
	for _, id := range []string{fa.ID, sb.ID, pb.ID} {
		docHash[id] = x.hash(t, id)
	}

	second := x.run(t, false, x.tn.orgID)
	if second.Units != 0 || second.MovedFolders != 0 || second.RelocatedDocuments != 0 || len(second.Skipped) != 0 {
		t.Fatalf("second pass = %+v, want nothing", second)
	}
	if n := x.count(t, `SELECT count(*) FROM audit_events WHERE organization_id = $1`, x.tn.orgID); n != auditAfter {
		t.Fatalf("a second pass wrote %d audit rows", n-auditAfter)
	}
	if n := x.count(t, `SELECT count(*) FROM outbox_events WHERE topic = 'document.moved'`); n != outboxAfter {
		t.Fatal("a second pass wrote outbox rows")
	}
	for id, h := range docHash {
		if x.hash(t, id) != h {
			t.Fatalf("a second pass changed %s", id)
		}
	}
}

func TestFoldersIntoMyFolderOrganizationFilterLimitsThePass(t *testing.T) {
	x := newFimFixture(t, "fim10")
	other := x.f.tenant(t, "fim10b")
	mine := x.folder(t, x.tn.member, "Của tổ chức này", "")
	v, err := x.f.svc.CreatePage(x.f.ctx, Human(other.member.ID), other.wsA, CreatePageInput{Kind: DocumentKindFolder, Title: "Của tổ chức khác"})
	if err != nil {
		t.Fatal(err)
	}
	theirs := v.Document
	theirsBefore := x.hash(t, theirs.ID)

	x.run(t, false, x.tn.orgID)
	if x.get(t, mine.ID).ParentID.Valid == false {
		t.Fatal("the filtered organization's folder did not move")
	}
	if x.hash(t, theirs.ID) != theirsBefore {
		t.Fatal("a pass limited to one organization touched another")
	}

	all := x.run(t, false, "")
	if all.Units < 1 {
		t.Fatalf("an unfiltered pass = %+v, want the other organization's folder moved", all)
	}
	if !x.get(t, theirs.ID).ParentID.Valid {
		t.Fatal("an unfiltered pass left the other organization's folder at the root")
	}
}

func TestFoldersIntoMyFolderIncludesArchivedFolders(t *testing.T) {
	x := newFimFixture(t, "fim11")
	root := x.folder(t, x.tn.member, "Trong thùng rác", "")
	if _, err := x.f.pool.Exec(x.f.ctx,
		`UPDATE documents SET archived_at = now(), purge_after = now() + interval '30 days' WHERE id = $1`, root.ID); err != nil {
		t.Fatal(err)
	}

	res := x.run(t, false, x.tn.orgID)
	if res.MovedFolders != 1 {
		t.Fatalf("report = %+v, want the archived folder moved", res)
	}
	got := x.get(t, root.ID)
	if !got.ArchivedAt.Valid {
		t.Fatal("the archived folder stopped being archived")
	}
	if p := got.ParentID; !p.Valid || p.String != x.myFolder(t, x.tn.member).ID {
		t.Fatalf("archived folder parent = %v, want the owner's My Folder so a restore lands private", p)
	}
}

func TestFoldersIntoMyFolderSkipsFolderWithoutOwnerWithReason(t *testing.T) {
	x := newFimFixture(t, "fim12")
	orphan := x.folder(t, x.tn.member, "Không chủ", "")
	if _, err := x.f.pool.Exec(x.f.ctx, `UPDATE documents SET acl_owner_id = NULL WHERE id = $1`, orphan.ID); err != nil {
		t.Fatal(err)
	}
	good := x.folder(t, x.tn.creator, "Có chủ", "")

	res := x.run(t, false, x.tn.orgID)
	if res.MovedFolders != 1 || len(res.Skipped) != 1 || res.Skipped[0].FolderID != orphan.ID || res.Skipped[0].Reason == "" {
		t.Fatalf("report = %+v, want the ownerless folder skipped with a reason and the other moved", res)
	}
	if x.get(t, orphan.ID).ParentID.Valid {
		t.Fatal("the skipped folder moved")
	}
	if !x.get(t, good.ID).ParentID.Valid {
		t.Fatal("one skipped folder stopped the pass")
	}
}
