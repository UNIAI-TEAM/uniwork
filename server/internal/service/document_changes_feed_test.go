package service

import (
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// G5-01b (UNI-1346) acceptance: the incremental feed after a snapshot, its
// change kinds, tombstones, removal visibility, the filtered-page cursor, the
// in-flight transaction guard, the epoch boundary, the lag metric and the two
// OQ-P1 tests. Every test drives the real commands (CreatePage, MoveDocument,
// ShareDocument, RevokeDocumentShare, ArchiveDocument, RestoreDocument,
// UpdateDocument), so the feed is exercised against the audit rows production
// writes.

// feedWorld is the G5-01b fixture: the G5-01a changeWorld plus helpers that
// drive document commands and page the feed to the end.
type feedWorld struct {
	*changeWorld
}

func newFeedWorld(t *testing.T, slug string) *feedWorld {
	t.Helper()
	return &feedWorld{newChangeWorld(t, slug, nil)}
}

// feedClaims decodes a feed cursor's signed claims with the service codec, so
// a test can assert on the keyset POSITION rather than the opaque token: the
// server re-signs ExpiresAt from its clock on every page (BE-G3-4), so the
// bytes may differ while the position stands still.
func (w *feedWorld) feedClaims(t *testing.T, cursor string) changeCursorClaims {
	t.Helper()
	claims, err := w.svc.codec.verify(cursor, w.cursorScope(w.tn.orgID), w.now)
	if err != nil {
		t.Fatalf("decode feed cursor %q: %v", cursor, err)
	}
	if claims.Phase != changeCursorPhaseFeed {
		t.Fatalf("cursor %q phase = %q, want feed", cursor, claims.Phase)
	}
	return claims
}

// feedRowsByDoc returns the feed rows keyed by document id (one row per
// document per page).
func feedRowsByDoc(rows []DocumentChangeFeedRow) map[string]DocumentChangeFeedRow {
	out := make(map[string]DocumentChangeFeedRow, len(rows))
	for _, r := range rows {
		out[r.DocumentID] = r
	}
	return out
}

// drainFeed pages the feed for the fixture's member until has_more is false,
// returning every row. A bounded loop so a cursor that never advances fails
// loudly.
func (w *feedWorld) drainFeed(t *testing.T, cursor string, limit int) []DocumentChangeFeedRow {
	t.Helper()
	return w.drainFeedFor(t, w.tn.member.ID, cursor, limit)
}

// drainFeedFor is drainFeed for one user: a cursor is bound to the account it
// was minted for, so each caller drains their own.
func (w *feedWorld) drainFeedFor(t *testing.T, user, cursor string, limit int) []DocumentChangeFeedRow {
	t.Helper()
	var all []DocumentChangeFeedRow
	for i := 0; ; i++ {
		page, err := w.list(t, user, cursor, limit)
		if err != nil {
			t.Fatalf("feed page %d: %v", i, err)
		}
		if page.Phase != changeCursorPhaseFeed {
			t.Fatalf("feed page %d phase = %q, want feed", i, page.Phase)
		}
		all = append(all, page.Feed...)
		if !page.HasMore {
			return all
		}
		if page.NextCursor == cursor {
			t.Fatalf("feed page %d repeated its cursor %q", i, cursor)
		}
		cursor = page.NextCursor
		if i > 100 {
			t.Fatal("feed never ended")
		}
	}
}

// snapshotThenFeed opens a cold start and returns the feed cursor (the last
// snapshot page's next cursor) plus the documents the snapshot held.
func (w *feedWorld) snapshotThenFeed(t *testing.T, limit int) (string, map[string]bool) {
	t.Helper()
	var cursor string
	held := map[string]bool{}
	for i := 0; ; i++ {
		page, err := w.list(t, w.tn.member.ID, cursor, limit)
		if err != nil {
			t.Fatalf("snapshot page %d: %v", i, err)
		}
		for _, c := range page.Changes {
			held[c.DocumentID] = true
		}
		if !page.HasMore {
			return page.NextCursor, held
		}
		cursor = page.NextCursor
		if i > 100 {
			t.Fatal("snapshot never ended")
		}
	}
}

// createPage drives the real create command so its audit row is written the
// way production writes it.
func (w *feedWorld) createPage(t *testing.T, title string) db.Document {
	t.Helper()
	view, err := w.f.svc.CreatePage(w.f.ctx, Human(w.tn.member.ID), w.tn.wsA, CreatePageInput{
		Kind: DocumentKindPage, Title: title, Visibility: "workspace", IdempotencyKey: util.NewID(),
	})
	if err != nil {
		t.Fatalf("create page %q: %v", title, err)
	}
	return view.Document
}

// updateTitle drives the metadata PATCH (a revision bump with no new version).
func (w *feedWorld) updateTitle(t *testing.T, doc db.Document, title string) db.Document {
	t.Helper()
	view, err := w.f.svc.UpdateDocument(w.f.ctx, Human(w.tn.member.ID), doc.ID, UpdateDocumentInput{
		Revision: doc.Revision, Title: &title,
	})
	if err != nil {
		t.Fatalf("update title: %v", err)
	}
	return view.Document
}

// auditChange appends the audit row a document command writes, without going
// through the command itself: used where the row's resource state is what the
// feed must read (a hard delete, a cross-workspace move).
func (w *feedWorld) auditChange(t *testing.T, action, documentID string) {
	t.Helper()
	insertRow(t, w.f.ctx, w.f.pool, "audit_events", map[string]any{
		"id": util.NewID(), "organization_id": w.tn.orgID, "workspace_id": w.tn.wsA,
		"actor_kind": "human", "actor_id": w.tn.owner.ID, "action": action,
		"resource_type": "document", "resource_id": documentID, "correlation_id": util.NewID(),
	})
}

// TestDocumentChangesFeedDeliversCommitBetweenSnapshotAndFirstPage is the
// card's "a commit between the snapshot and the first feed page appears
// exactly once" test: the change is absent from the snapshot AND present in
// the feed, never both, never neither, and never twice.
//
// T-2: the rows are COUNTED per document across one-row pages, not folded into
// a map. A map would collapse a duplicate delivery (the same document delivered
// on two pages, or once per audit row) into a single entry and pass; the count
// does not. The mid-build race itself is proven by
// TestDocumentChangesHighWaterHandoffCommitsMidBuild in document_changes_test.go.
func TestDocumentChangesFeedDeliversCommitBetweenSnapshotAndFirstPage(t *testing.T) {
	w := newFeedWorld(t, "chgfeedonce")
	before := w.createPage(t, "before the snapshot")

	feedCursor, held := w.snapshotThenFeed(t, 200)
	if !held[before.ID] {
		t.Fatal("the pre-snapshot document is missing from the snapshot")
	}

	// One commit that lands after the snapshot's MVCC point, before the first
	// feed page.
	after := w.createPage(t, "after the snapshot")
	if held[after.ID] {
		t.Fatal("a document created after the snapshot is in the snapshot")
	}

	counts := map[string]int{}
	var got DocumentChangeFeedRow
	for _, r := range w.drainFeed(t, feedCursor, 1) {
		counts[r.DocumentID]++
		if r.DocumentID == after.ID {
			got = r
		}
	}
	if counts[before.ID] != 0 {
		t.Fatalf("a document already in the snapshot was delivered %d times by the feed, want 0", counts[before.ID])
	}
	if counts[after.ID] != 1 {
		t.Fatalf("the commit between the snapshot and the first feed page appears %d times, want exactly 1", counts[after.ID])
	}
	if got.ChangeKind != DocumentChangeKindUpsert || got.Revision != after.Revision {
		t.Fatalf("feed row = %+v, want upsert revision %d", got, after.Revision)
	}
}

// TestDocumentChangesFeedHoldsBackAYoungerCommitWhileAnOlderTransactionRuns is
// the in-progress-xid guard: a transaction that has its xid and is still open
// must keep every younger commit out of the page. Delivering the younger
// commit would advance the cursor past the older transaction's xid, and its
// change would be skipped forever once it commits. Both are delivered, in xid
// order, after the older transaction commits.
func TestDocumentChangesFeedHoldsBackAYoungerCommitWhileAnOlderTransactionRuns(t *testing.T) {
	w := newFeedWorld(t, "chgfeedinflight")
	doc := w.createPage(t, "the older change")
	feedCursor, _ := w.snapshotThenFeed(t, 200)

	// The older transaction: it takes its xid (an UPDATE assigns one) and
	// writes its audit row, then stays open.
	older, err := w.f.pool.Begin(w.f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = older.Rollback(w.f.ctx) }()
	if _, err := older.Exec(w.f.ctx, `UPDATE documents SET revision = revision + 1 WHERE id = $1`, doc.ID); err != nil {
		t.Fatal(err)
	}
	insertRow(t, w.f.ctx, older, "audit_events", map[string]any{
		"id": util.NewID(), "organization_id": w.tn.orgID, "workspace_id": w.tn.wsA,
		"actor_kind": "human", "actor_id": w.tn.member.ID, "action": "document.updated",
		"resource_type": "document", "resource_id": doc.ID, "correlation_id": util.NewID(),
	})

	// The younger transaction commits while the older one is still open.
	younger := w.createPage(t, "the younger change")

	page, err := w.list(t, w.tn.member.ID, feedCursor, 200)
	if err != nil {
		t.Fatalf("feed while a transaction is in flight: %v", err)
	}
	// Every candidate is held back by the in-flight guard, so this page
	// advanced nothing: has_more=false with the cursor POSITION unchanged
	// (BE-G2-2/BE-G3-4). The client polls again later; the held row is
	// delayed, never lost.
	if page.HasMore {
		t.Fatal("a page that advanced nothing must answer has_more=false (BE-G2-2)")
	}
	// The invariant is the POSITION, not the opaque bytes: the server re-signs
	// ExpiresAt from its clock on every page (BE-G3-4), so the token may differ
	// while the keyset stands still. Decode both and compare the keyset.
	before := w.feedClaims(t, feedCursor)
	after := w.feedClaims(t, page.NextCursor)
	if after.AfterXact != before.AfterXact || after.AfterID != before.AfterID {
		t.Fatalf("the held-back page moved its cursor position: (%s,%s) -> (%s,%s)",
			before.AfterXact, before.AfterID, after.AfterXact, after.AfterID)
	}
	for _, r := range page.Feed {
		if r.DocumentID == younger.ID {
			t.Fatal("the feed delivered a commit whose xid sits above the read's xmin (an older transaction is still in flight); a client advancing past it would lose that older change")
		}
	}

	// BE-G3-4: the position is kept even when the poll happens later and the
	// server re-signs the expiry. Advance the injected clock past the minted
	// cursor's expiry window and poll again: the keyset is unchanged and
	// has_more stays false, while the new token's expiry may be refreshed.
	w.now = w.now.Add(time.Minute)
	later, err := w.list(t, w.tn.member.ID, page.NextCursor, 200)
	if err != nil {
		t.Fatalf("poll the held-back page after the clock advanced: %v", err)
	}
	if later.HasMore {
		t.Fatal("a page that advanced nothing must answer has_more=false after the clock advanced (BE-G3-4)")
	}
	laterClaims := w.feedClaims(t, later.NextCursor)
	if laterClaims.AfterXact != before.AfterXact || laterClaims.AfterID != before.AfterID {
		t.Fatalf("the position moved when the clock advanced: (%s,%s) -> (%s,%s)",
			before.AfterXact, before.AfterID, laterClaims.AfterXact, laterClaims.AfterID)
	}
	if laterClaims.ExpiresAt <= after.ExpiresAt {
		t.Fatalf("a later poll must re-sign a later expiry: %d -> %d", after.ExpiresAt, laterClaims.ExpiresAt)
	}

	// After the older transaction commits, the same cursor still finds both.
	if err := older.Commit(w.f.ctx); err != nil {
		t.Fatal(err)
	}
	rows := feedRowsByDoc(w.drainFeed(t, feedCursor, 200))
	got, ok := rows[doc.ID]
	if !ok {
		t.Fatal("the held-back change was skipped instead of delivered once it committed")
	}
	if got.Revision != doc.Revision+1 {
		t.Fatalf("held-back revision = %d, want %d", got.Revision, doc.Revision+1)
	}
	if _, ok := rows[younger.ID]; !ok {
		t.Fatal("the younger commit was lost after the older transaction settled")
	}
}

// TestDocumentChangesFeedTombstoneNeverReappears is the card's "a tombstone
// never resurrects on later pages" test under the reconstruction rule
// (BE-G1-1/BE-G1-2 and addendum A): document.deleted is the retention purge -
// it destroys the row and its permission rows in one transaction - so for a
// cursor whose snapshot may have seen the document the feed answers 410
// change_cursor_expired (never a silent skip, never a removal to unproven
// readers), and a stale later audit row never resurrects the document as live.
func TestDocumentChangesFeedTombstoneNeverReappears(t *testing.T) {
	w := newFeedWorld(t, "chgtombstone")
	doc := w.createPage(t, "to be deleted")
	feedCursor, held := w.snapshotThenFeed(t, 200)
	if !held[doc.ID] {
		t.Fatal("the fixture is wrong: the member could not read the document")
	}

	// A hard delete of the document row, with the audit row a purge writes.
	if _, err := w.f.pool.Exec(w.f.ctx, `DELETE FROM documents WHERE id = $1`, doc.ID); err != nil {
		t.Fatal(err)
	}
	insertRow(t, w.f.ctx, w.f.pool, "audit_events", map[string]any{
		"id": util.NewID(), "organization_id": w.tn.orgID, "workspace_id": w.tn.wsA,
		"actor_kind": "system", "actor_id": "documents.purge", "action": "document.deleted",
		"resource_type": "document", "resource_id": doc.ID, "correlation_id": util.NewID(),
	})

	// The cursor may have seen the document and the purge destroyed the state
	// the removal decision needs: 410, not a silent skip, not a removal to
	// everyone.
	if _, err := w.list(t, w.tn.member.ID, feedCursor, 200); !codedIs(err, "change_cursor_expired") {
		t.Fatalf("a purge the cursor may have seen = %v, want 410 change_cursor_expired", err)
	}

	// A later stale audit row for the same (now deleted) id must not re-emit
	// the document as a live upsert.
	insertRow(t, w.f.ctx, w.f.pool, "audit_events", map[string]any{
		"id": util.NewID(), "organization_id": w.tn.orgID, "workspace_id": w.tn.wsA,
		"actor_kind": "human", "actor_id": w.tn.member.ID, "action": "document.updated",
		"resource_type": "document", "resource_id": doc.ID, "correlation_id": util.NewID(),
	})
	// A fresh snapshot + feed must not resurrect it either: the document row
	// is gone, so the stale audit row resolves to nothing, and a stranger
	// never sees one.
	fresh, heldFresh := w.snapshotThenFeed(t, 200)
	if heldFresh[doc.ID] {
		t.Fatal("the fresh snapshot holds a deleted document")
	}
	for _, r := range w.drainFeed(t, fresh, 200) {
		if r.DocumentID == doc.ID {
			t.Fatalf("a stale row resurrected a purged document: %+v", r)
		}
	}
}

// TestDocumentChangesFeedRemovalIsIDsOnly proves the removal payload carries
// no name, path or metadata: only the document id, revision and reason. The
// removal is driven by a real RevokeDocumentShare (a purge now answers 410,
// see TestDocumentChangesFeedTombstoneNeverReappears).
func TestDocumentChangesFeedRemovalIsIDsOnly(t *testing.T) {
	w := newFeedWorld(t, "chgremovalids")
	doc := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "restricted", createdBy: w.tn.owner.ID})
	share := w.f.share(t, doc, DocumentPrincipalUser, w.tn.member.ID, DocumentLevelView, w.tn.owner.ID)
	feedCursor, _ := w.snapshotThenFeed(t, 200)

	if err := w.f.svc.RevokeDocumentShare(w.f.ctx, Human(w.tn.owner.ID), doc.ID, share.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	var removal DocumentChangeFeedRow
	for _, r := range w.drainFeed(t, feedCursor, 200) {
		if r.DocumentID == doc.ID {
			removal = r
		}
	}
	if removal.ChangeKind != DocumentChangeKindRemoval {
		t.Fatalf("removal = %+v, want a removal row", removal)
	}
	if removal.Kind != "" || removal.CurrentVersion != 0 || removal.FileVersionID != "" {
		t.Fatalf("a removal carries document fields: %+v", removal)
	}
	if removal.Archived || removal.Removal != DocumentChangeRemovalPermissionRevoked {
		t.Fatalf("removal = %+v, want an unarchived permission_revoked removal", removal)
	}
	// The row struct itself is the payload the handler maps to the SDO: assert
	// its every field, so a new field (a title, a path, metadata) fails here
	// rather than passing a substring scan. The exact wire key set is pinned at
	// the handler (TestDocumentChangesHTTPFeedRows, T-1).
	body, err := json.Marshal(removal)
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]any
	if err := json.Unmarshal(body, &wire); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"DocumentID": doc.ID, "ChangeKind": DocumentChangeKindRemoval, "Kind": "",
		"Revision": float64(removal.Revision), "CurrentVersion": float64(0),
		"FileVersionID": "", "Archived": false, "Removal": DocumentChangeRemovalPermissionRevoked,
	}
	if len(wire) != len(want) {
		t.Fatalf("the removal row carries %d fields, want %d: %s", len(wire), len(want), body)
	}
	for k, v := range want {
		if wire[k] != v {
			t.Fatalf("removal field %s = %v, want %v (%s)", k, wire[k], v, body)
		}
	}
}

// TestDocumentChangesFeedRemovalOnlyToSomeoneWhoHadAccess is the card's
// "removal goes only to someone who HAD access" test: a caller who could
// never read the document learns nothing, not even that it exists.
func TestDocumentChangesFeedRemovalOnlyToSomeoneWhoHadAccess(t *testing.T) {
	w := newFeedWorld(t, "chgremovalvis")
	// A restricted document the member never had access to.
	restricted := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "restricted", createdBy: w.tn.owner.ID})
	feedCursor, held := w.snapshotThenFeed(t, 200)
	if held[restricted.ID] {
		t.Fatal("the fixture is wrong: the member could read the restricted document")
	}

	if _, err := w.f.pool.Exec(w.f.ctx, `DELETE FROM documents WHERE id = $1`, restricted.ID); err != nil {
		t.Fatal(err)
	}
	insertRow(t, w.f.ctx, w.f.pool, "audit_events", map[string]any{
		"id": util.NewID(), "organization_id": w.tn.orgID, "workspace_id": w.tn.wsA,
		"actor_kind": "system", "actor_id": "documents.purge", "action": "document.deleted",
		"resource_type": "document", "resource_id": restricted.ID, "correlation_id": util.NewID(),
	})

	for _, r := range w.drainFeed(t, feedCursor, 200) {
		if r.DocumentID == restricted.ID {
			t.Fatalf("a caller who never had access received a removal: %+v", r)
		}
	}
}

// TestDocumentChangesFeedFilteredPageCursorAdvances is the card's "a page
// where every event is filtered out still advances the cursor" test: no
// infinite loop, no repeated cursor.
func TestDocumentChangesFeedFilteredPageCursorAdvances(t *testing.T) {
	w := newFeedWorld(t, "chgfiltered")
	// One readable document so the snapshot is not empty.
	w.createPage(t, "readable")
	feedCursor, _ := w.snapshotThenFeed(t, 200)

	// Three changes to a restricted document the member never read: all three
	// filter out, so the page has no rows but must still advance.
	hidden := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "restricted", createdBy: w.tn.owner.ID})
	for i := 0; i < 3; i++ {
		w.auditChange(t, "document.updated", hidden.ID)
	}

	page, err := w.list(t, w.tn.member.ID, feedCursor, 2)
	if err != nil {
		t.Fatalf("filtered page: %v", err)
	}
	if len(page.Feed) != 0 {
		t.Fatalf("filtered page returned %d rows, want 0", len(page.Feed))
	}
	if page.NextCursor == feedCursor {
		t.Fatal("a page whose every row was filtered repeated the same cursor")
	}
	if !page.HasMore {
		t.Fatal("a page that stopped at the limit with a change still pending reported no more")
	}
	// T-6: the cursor POSITION advanced past the hidden rows, not merely the
	// token bytes (the server re-signs expiry each page, so a stuck keyset could
	// still differ). Decode both claims and assert the keyset moved.
	before := w.feedClaims(t, feedCursor)
	after := w.feedClaims(t, page.NextCursor)
	if after.AfterXact == "" && after.AfterID == "" {
		t.Fatalf("the filtered page handed out an empty keyset: %+v", after)
	}
	if after.AfterXact == before.AfterXact && after.AfterID == before.AfterID {
		t.Fatalf("the filtered page kept the keyset (%s,%s) instead of advancing past the hidden rows",
			before.AfterXact, before.AfterID)
	}
	// The next page starts past the filtered rows, so the feed drains to empty
	// instead of looping.
	if got := len(w.drainFeed(t, feedCursor, 2)); got != 0 {
		t.Fatalf("filtered feed drained %d rows, want 0", got)
	}
}

// TestDocumentChangesFeedPermissionGrantIsUpsert is the card's grant case: a
// share that admits the caller (the real ShareDocument command, its
// document.shared audit row) reaches them as an upsert, even though the
// snapshot never held the restricted document.
func TestDocumentChangesFeedPermissionGrantIsUpsert(t *testing.T) {
	w := newFeedWorld(t, "chggrant")
	doc := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "restricted", createdBy: w.tn.owner.ID})
	feedCursor, held := w.snapshotThenFeed(t, 200)
	if held[doc.ID] {
		t.Fatal("the fixture is wrong: the member already reads the restricted document")
	}

	if _, err := w.f.svc.ShareDocument(w.f.ctx, Human(w.tn.owner.ID), doc.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: w.tn.member.ID, Level: DocumentLevelView,
	}); err != nil {
		t.Fatalf("share: %v", err)
	}
	got, ok := feedRowsByDoc(w.drainFeed(t, feedCursor, 200))[doc.ID]
	if !ok {
		t.Fatal("a grant did not reach the newly admitted reader")
	}
	if got.ChangeKind != DocumentChangeKindUpsert || got.Revision != doc.Revision {
		t.Fatalf("grant row = %+v, want upsert revision %d", got, doc.Revision)
	}
}

// TestDocumentChangesFeedPermissionRevokeIsRemoval proves a lost read level
// reaches the caller who had access as an ids-only removal, driven by the real
// RevokeDocumentShare command (its document.share_revoked audit row).
func TestDocumentChangesFeedPermissionRevokeIsRemoval(t *testing.T) {
	w := newFeedWorld(t, "chgrevoke")
	doc := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "restricted", createdBy: w.tn.owner.ID})
	share := w.f.share(t, doc, DocumentPrincipalUser, w.tn.member.ID, DocumentLevelView, w.tn.owner.ID)
	feedCursor, held := w.snapshotThenFeed(t, 200)
	if !held[doc.ID] {
		t.Fatal("the fixture is wrong: the member could not read the shared document")
	}

	if err := w.f.svc.RevokeDocumentShare(w.f.ctx, Human(w.tn.owner.ID), doc.ID, share.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	got, ok := feedRowsByDoc(w.drainFeed(t, feedCursor, 200))[doc.ID]
	if !ok {
		t.Fatal("a permission revoke did not reach the caller who had access")
	}
	if got.ChangeKind != DocumentChangeKindRemoval || got.Removal != DocumentChangeRemovalPermissionRevoked {
		t.Fatalf("revoke row = %+v, want removal permission_revoked", got)
	}
	if got.Kind != "" || got.FileVersionID != "" {
		t.Fatalf("the removal carries document fields: %+v", got)
	}
}

// TestDocumentChangesFeedMoveWithinWorkspaceIsUpsert covers a same-workspace
// move: the document stays, so the row is an upsert.
func TestDocumentChangesFeedMoveWithinWorkspaceIsUpsert(t *testing.T) {
	w := newFeedWorld(t, "chgmovews")
	folder := w.createPage(t, "folder parent")
	doc := w.createPage(t, "to move")
	feedCursor, _ := w.snapshotThenFeed(t, 200)

	if _, err := w.f.svc.MoveDocument(w.f.ctx, Human(w.tn.member.ID), doc.ID, MoveDocumentInput{
		ParentID: folder.ID, Revision: doc.Revision, IdempotencyKey: util.NewID(),
	}); err != nil {
		t.Fatalf("move: %v", err)
	}
	got, ok := feedRowsByDoc(w.drainFeed(t, feedCursor, 200))[doc.ID]
	if !ok {
		t.Fatal("a same-workspace move did not reach the feed")
	}
	if got.ChangeKind != DocumentChangeKindUpsert || got.Archived {
		t.Fatalf("move row = %+v, want an upsert", got)
	}
}

// TestDocumentChangesFeedMoveAcrossWorkspaceIsRemoval is the card's
// cross-workspace move: leaving the caller's workspace is a removal for that
// workspace. No command on this root moves a document across workspaces yet
// (MoveDocument is the tree move inside one workspace), so the test drives the
// row state such a command leaves behind - the document now in workspace B,
// its audit row in workspace A - and the feed's answer to it. The arrival
// upsert in the target workspace needs a row there, which only the command
// that performs the move can write.
func TestDocumentChangesFeedMoveAcrossWorkspaceIsRemoval(t *testing.T) {
	w := newFeedWorld(t, "chgmovecross")
	doc := w.createPage(t, "leaving")
	feedCursor, _ := w.snapshotThenFeed(t, 200)

	if _, err := w.f.pool.Exec(w.f.ctx,
		`UPDATE documents SET workspace_id = $2 WHERE id = $1`, doc.ID, w.tn.wsB); err != nil {
		t.Fatal(err)
	}
	w.auditChange(t, "document.moved", doc.ID)

	got, ok := feedRowsByDoc(w.drainFeed(t, feedCursor, 200))[doc.ID]
	if !ok {
		t.Fatal("a cross-workspace move did not reach the feed")
	}
	if got.ChangeKind != DocumentChangeKindRemoval || got.Removal != DocumentChangeRemovalMovedWorkspace {
		t.Fatalf("cross-workspace move row = %+v, want removal moved_workspace", got)
	}
	if got.Kind != "" {
		t.Fatalf("the removal names a document field: %+v", got)
	}
}

// TestDocumentChangesFeedArchiveRestoreAreUpserts proves archive and restore
// are distinct from delete: an archive is an upsert carrying archived=true, a
// restore an upsert carrying archived=false.
func TestDocumentChangesFeedArchiveRestoreAreUpserts(t *testing.T) {
	w := newFeedWorld(t, "chgarch")
	doc := w.createPage(t, "archived then restored")
	feedCursor, _ := w.snapshotThenFeed(t, 200)

	archived, err := w.f.svc.ArchiveDocument(w.f.ctx, Human(w.tn.member.ID), doc.ID, ArchiveDocumentInput{IdempotencyKey: util.NewID()})
	if err != nil {
		t.Fatalf("archive: %v", err)
	}
	got, ok := feedRowsByDoc(w.drainFeed(t, feedCursor, 200))[doc.ID]
	if !ok {
		t.Fatal("archive did not reach the feed")
	}
	if got.ChangeKind != DocumentChangeKindUpsert || !got.Archived {
		t.Fatalf("archive row = %+v, want upsert archived=true", got)
	}

	restored, err := w.f.svc.RestoreDocument(w.f.ctx, Human(w.tn.member.ID), doc.ID, ArchiveDocumentInput{IdempotencyKey: util.NewID()})
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	got, ok = feedRowsByDoc(w.drainFeed(t, feedCursor, 200))[doc.ID]
	if !ok {
		t.Fatal("restore did not reach the feed")
	}
	if got.ChangeKind != DocumentChangeKindUpsert || got.Archived {
		t.Fatalf("restore row = %+v, want upsert archived=false", got)
	}
	if got.Revision != restored.View.Document.Revision || got.Revision <= archived.View.Document.Revision {
		t.Fatalf("restore revision = %d, want the bumped %d", got.Revision, restored.View.Document.Revision)
	}
}

// TestDocumentChangesFeedMetadataBumpRebasesBaseRevision is the card's
// "unarchive then web save -> saved" OQ-P1 test on the feed side: a
// metadata-only revision bump (a restore, and a rename) reaches the feed with
// the version pointer unchanged, so a client can rebase base_revision instead
// of treating the bump as new content. The commit-side half (move then
// dispatch, unarchive then save) is TestDocumentContentRevision.
func TestDocumentChangesFeedMetadataBumpRebasesBaseRevision(t *testing.T) {
	w := newFeedWorld(t, "chgoqp1b")
	doc := w.createPage(t, "metadata bump")
	if _, err := w.f.svc.ArchiveDocument(w.f.ctx, Human(w.tn.member.ID), doc.ID, ArchiveDocumentInput{IdempotencyKey: util.NewID()}); err != nil {
		t.Fatalf("archive: %v", err)
	}
	feedCursor, _ := w.snapshotThenFeed(t, 200)

	res, err := w.f.svc.RestoreDocument(w.f.ctx, Human(w.tn.member.ID), doc.ID, ArchiveDocumentInput{IdempotencyKey: util.NewID()})
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	got, ok := feedRowsByDoc(w.drainFeed(t, feedCursor, 200))[doc.ID]
	if !ok {
		t.Fatal("the metadata bump did not reach the feed")
	}
	if got.Revision != res.View.Document.Revision || got.Revision <= doc.Revision {
		t.Fatalf("feed revision = %d, want the bumped %d", got.Revision, res.View.Document.Revision)
	}
	if got.CurrentVersion != doc.CurrentVersion {
		t.Fatalf("the version counter moved on a metadata bump: %d -> %d", doc.CurrentVersion, got.CurrentVersion)
	}
	if got.FileVersionID != doc.FileVersionID.String {
		t.Fatalf("version pointer moved on a metadata bump: %q -> %q", doc.FileVersionID.String, got.FileVersionID)
	}

	// A rename takes the same path: revision moves, the version pointer does
	// not.
	renamed := w.updateTitle(t, res.View.Document, "renamed")
	got, ok = feedRowsByDoc(w.drainFeed(t, feedCursor, 200))[doc.ID]
	if !ok {
		t.Fatal("the rename did not reach the feed")
	}
	if got.Revision != renamed.Revision || got.Revision <= res.View.Document.Revision {
		t.Fatalf("rename feed revision = %d, want %d", got.Revision, renamed.Revision)
	}
	if got.FileVersionID != doc.FileVersionID.String {
		t.Fatalf("rename moved the version pointer: %q -> %q", doc.FileVersionID.String, got.FileVersionID)
	}
}

// TestDocumentChangesFeedStaleHighWaterAnswersGone is the epoch boundary: a
// high-water mark taken before audit_events.xact_id existed can miss commits
// between it and the column, so the feed answers 410 (one cold start) instead
// of a feed with a hole in it. A cursor from a real snapshot is served.
func TestDocumentChangesFeedStaleHighWaterAnswersGone(t *testing.T) {
	w := newFeedWorld(t, "chgstale")
	w.createPage(t, "current")
	feedCursor, _ := w.snapshotThenFeed(t, 200)

	// Control: a real cursor is served, never 410.
	if page, err := w.list(t, w.tn.member.ID, feedCursor, 10); err != nil || page.Phase != changeCursorPhaseFeed {
		t.Fatalf("a fresh feed cursor = %+v, %v; want a feed page", page, err)
	}

	// '1:1:' is the empty snapshot: it predates every xid, the epoch included.
	claims := changeCursorClaims{
		Protocol: DocumentChangeProtocol, Deployment: "dep-test", UserID: w.tn.member.ID,
		Organization: w.tn.orgID, Workspace: w.tn.wsA,
		Phase: changeCursorPhaseFeed, HighWater: "1:1:", ExpiresAt: w.now.Add(time.Hour).Unix(),
	}
	token, err := w.svc.codec.sign(claims)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.list(t, w.tn.member.ID, token, 10); !codedIs(err, "change_cursor_expired") {
		t.Fatalf("a high-water mark older than the position column = %v, want 410 change_cursor_expired", err)
	}
}

// feedLagRecorder is the DocumentChangeFeedLagMetrics fake: it keeps the last
// observation so the test can read the metric the way Prometheus would.
type feedLagRecorder struct {
	mu   sync.Mutex
	last float64
	seen int
}

func (r *feedLagRecorder) ObserveDocumentChangeFeedLag(seconds float64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.last = seconds
	r.seen++
}

func (r *feedLagRecorder) snapshot() (float64, int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.last, r.seen
}

// TestDocumentChangesFeedLagMetricMovesUnderLag proves the feed lag metric:
// while a page leaves a committed change undelivered the observed lag is that
// change's age, and the page that catches the caller up observes zero.
func TestDocumentChangesFeedLagMetricMovesUnderLag(t *testing.T) {
	w := newFeedWorld(t, "chglag")
	first := w.createPage(t, "oldest pending")
	w.createPage(t, "newer pending")
	feedCursor, _ := w.snapshotThenFeed(t, 200)

	// Two changes committed after the snapshot, back-dated so their age is
	// known: the older at ten minutes, the younger at five.
	backdate := func(doc db.Document, age time.Duration) {
		t.Helper()
		insertRow(t, w.f.ctx, w.f.pool, "audit_events", map[string]any{
			"id": util.NewID(), "organization_id": w.tn.orgID, "workspace_id": w.tn.wsA,
			"actor_kind": "human", "actor_id": w.tn.member.ID, "action": "document.updated",
			"resource_type": "document", "resource_id": doc.ID, "correlation_id": util.NewID(),
			"occurred_at": time.Now().Add(-age),
		})
	}
	backdate(first, 10*time.Minute)
	second := w.createPage(t, "second pending")
	backdate(second, 5*time.Minute)

	rec := &feedLagRecorder{}
	w.svc.SetFeedLagMetrics(rec)

	// One row per page: the older change is delivered, the younger stays owed,
	// so the lag is the younger change's age.
	page, err := w.list(t, w.tn.member.ID, feedCursor, 1)
	if err != nil {
		t.Fatalf("feed page: %v", err)
	}
	if len(page.Feed) != 1 {
		t.Fatalf("page of one = %+v, want one row", page.Feed)
	}
	lag, seen := rec.snapshot()
	if seen != 1 {
		t.Fatalf("lag observations = %d, want 1", seen)
	}
	if lag < 4*60 || lag > 7*60 {
		t.Fatalf("feed lag = %v, want about 300s (the oldest change still owed)", lag)
	}

	// The page that drains the rest leaves nothing owed: lag 0.
	if _, err := w.list(t, w.tn.member.ID, page.NextCursor, 10); err != nil {
		t.Fatalf("caught-up page: %v", err)
	}
	if lag, _ := rec.snapshot(); lag != 0 {
		t.Fatalf("caught-up feed lag = %v, want 0", lag)
	}
}

// TestDocumentChangesFeedWorkProductRowsBlockedUntilC14 pins the C-14
// boundary (spec 11): a Work Product document's level is the owner resolver's
// answer alone, that resolver is not on this root (document_owner.go is only
// the default-deny seam), and the feed builds no ACL of its own. So an owned
// document reaches nobody - workspace admin included - and a caller who could
// read it before it became owned gets the ids-only removal.
func TestDocumentChangesFeedWorkProductRowsBlockedUntilC14(t *testing.T) {
	w := newFeedWorld(t, "chgwp")
	const workProduct = "01WPFEED0000000000000000000"

	t.Run("an owned document reaches nobody", func(t *testing.T) {
		owned := w.f.doc(t, w.tn, docSpec{
			ws: w.tn.wsA, visibility: "workspace", createdBy: w.tn.member.ID, ownerID: workProduct,
		})
		feedCursor, held := w.snapshotThenFeed(t, 200)
		if held[owned.ID] {
			t.Fatal("the snapshot holds a Work Product document (C-14 fan-out must not be built here)")
		}
		w.auditChange(t, "document.updated", owned.ID)

		// The member and the workspace admin both read the feed; neither may
		// learn anything about an owned document, and no removal is due (the
		// caller never had access). A cursor is bound to its account, so each
		// caller continues their own cursor.
		for _, user := range []string{w.tn.member.ID, w.tn.wsAdmin.ID} {
			cursor := feedCursor
			if user != w.tn.member.ID {
				page, err := w.list(t, user, "", 200)
				if err != nil || page.HasMore {
					t.Fatalf("cold start for %s = %+v, %v; want one page", user, page, err)
				}
				cursor = page.NextCursor
			}
			for _, r := range w.drainFeedFor(t, user, cursor, 200) {
				if r.DocumentID == owned.ID {
					t.Fatalf("%s received a row about an owned Work Product document: %+v", user, r)
				}
			}
		}
	})

	t.Run("a document that becomes owned is an ids-only removal for a former reader", func(t *testing.T) {
		plain := w.createPage(t, "becomes owned")
		feedCursor, held := w.snapshotThenFeed(t, 200)
		if !held[plain.ID] {
			t.Fatal("the fixture is wrong: the member could not read the document")
		}
		if _, err := w.f.pool.Exec(w.f.ctx,
			`UPDATE documents SET owner_kind = 'work_product', owner_id = $2 WHERE id = $1`, plain.ID, workProduct); err != nil {
			t.Fatal(err)
		}
		w.auditChange(t, "document.updated", plain.ID)

		got, ok := feedRowsByDoc(w.drainFeed(t, feedCursor, 200))[plain.ID]
		if !ok {
			t.Fatal("losing the document to a work product did not reach the former reader")
		}
		if got.ChangeKind != DocumentChangeKindRemoval || got.Removal != DocumentChangeRemovalPermissionRevoked {
			t.Fatalf("row = %+v, want the ids-only removal permission_revoked", got)
		}
		if got.Kind != "" || got.FileVersionID != "" {
			t.Fatalf("the removal carries document fields: %+v", got)
		}
	})
}

// TestDocumentChangesFeedRemovalSurvivesTheSnapshotSweep proves the removal
// basis outlives the snapshot items (BE-G1-2): the snapshot TTL is 15 minutes
// and the sweeper deletes the rows, but the feed cursor lives 7 days and a
// revoke still reaches the caller who could read the document. A purge that
// reaches the same cursor afterwards answers 410 instead of a silent skip
// (addendum A), because its evidence is gone.
func TestDocumentChangesFeedRemovalSurvivesTheSnapshotSweep(t *testing.T) {
	w := newFeedWorld(t, "chgsweep")
	revoked := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "restricted", createdBy: w.tn.owner.ID})
	share := w.f.share(t, revoked, DocumentPrincipalUser, w.tn.member.ID, DocumentLevelView, w.tn.owner.ID)
	purged := w.createPage(t, "purged later")
	feedCursor, held := w.snapshotThenFeed(t, 200)
	if !held[revoked.ID] || !held[purged.ID] {
		t.Fatal("the fixture is wrong: the member could not read the documents")
	}

	// The snapshot TTL (15 minutes) passes and the sweeper deletes the row and
	// its items; the feed cursor outlives them.
	sweeper := w.svc.NewSnapshotSweeper(nil)
	sweeper.SetClock(func() time.Time { return w.now.Add(2 * time.Hour) })
	if snapshots, _, err := sweeper.Sweep(w.f.ctx); err != nil || snapshots == 0 {
		t.Fatalf("sweep = %d, %v; want the expired snapshot gone", snapshots, err)
	}

	if err := w.f.svc.RevokeDocumentShare(w.f.ctx, Human(w.tn.owner.ID), revoked.ID, share.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	page, err := w.list(t, w.tn.member.ID, feedCursor, 200)
	if err != nil {
		t.Fatalf("feed after the sweep: %v", err)
	}
	got, ok := feedRowsByDoc(page.Feed)[revoked.ID]
	if !ok || got.ChangeKind != DocumentChangeKindRemoval || got.Removal != DocumentChangeRemovalPermissionRevoked {
		t.Fatalf("revoke after the sweep = %+v (found %v), want the ids-only removal", got, ok)
	}

	// A purge the cursor may have seen, with its snapshot evidence swept: 410,
	// never a silent skip and never a removal to everyone.
	if _, err := w.f.pool.Exec(w.f.ctx, `DELETE FROM documents WHERE id = $1`, purged.ID); err != nil {
		t.Fatal(err)
	}
	insertRow(t, w.f.ctx, w.f.pool, "audit_events", map[string]any{
		"id": util.NewID(), "organization_id": w.tn.orgID, "workspace_id": w.tn.wsA,
		"actor_kind": "system", "actor_id": "documents.purge", "action": "document.deleted",
		"resource_type": "document", "resource_id": purged.ID, "correlation_id": util.NewID(),
	})
	if _, err := w.list(t, w.tn.member.ID, page.NextCursor, 200); !codedIs(err, "change_cursor_expired") {
		t.Fatalf("purge after the sweep = %v, want 410 change_cursor_expired", err)
	}
}

// TestDocumentChangesFeedGrantAfterSnapshotThenRevokeIsRemoval is the
// contract's grant-then-revoke case: the grant landed after the snapshot (the
// snapshot never held the document), the caller could read right before the
// revoke, so the removal reaches them.
func TestDocumentChangesFeedGrantAfterSnapshotThenRevokeIsRemoval(t *testing.T) {
	w := newFeedWorld(t, "chggrantrevoke")
	doc := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "restricted", createdBy: w.tn.owner.ID})
	feedCursor, held := w.snapshotThenFeed(t, 200)
	if held[doc.ID] {
		t.Fatal("the fixture is wrong: the member already read the restricted document")
	}

	share, err := w.f.svc.ShareDocument(w.f.ctx, Human(w.tn.owner.ID), doc.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: w.tn.member.ID, Level: DocumentLevelView,
	})
	if err != nil {
		t.Fatalf("share: %v", err)
	}
	if err := w.f.svc.RevokeDocumentShare(w.f.ctx, Human(w.tn.owner.ID), doc.ID, share.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	got, ok := feedRowsByDoc(w.drainFeed(t, feedCursor, 200))[doc.ID]
	if !ok {
		t.Fatal("a grant-then-revoke did not reach the caller who could read before the revoke")
	}
	if got.ChangeKind != DocumentChangeKindRemoval || got.Removal != DocumentChangeRemovalPermissionRevoked {
		t.Fatalf("grant-then-revoke row = %+v, want removal permission_revoked", got)
	}
}

// TestDocumentChangesFeedNeverReaderGetsNothing pins the "never to someone who
// never had access" rule (BE-G1-2) for every removal kind: a caller who could
// not read the document gets no row about it - not even an id.
func TestDocumentChangesFeedNeverReaderGetsNothing(t *testing.T) {
	w := newFeedWorld(t, "chgnever")
	restricted := func() db.Document {
		return w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "restricted", createdBy: w.tn.owner.ID})
	}
	toDelete, toRevoke, toDemote, toMove := restricted(), restricted(), restricted(), restricted()
	otherShare := w.f.share(t, toRevoke, DocumentPrincipalUser, w.tn.wsAdmin.ID, DocumentLevelView, w.tn.owner.ID)
	feedCursor, held := w.snapshotThenFeed(t, 200)
	for _, d := range []db.Document{toDelete, toRevoke, toDemote, toMove} {
		if held[d.ID] {
			t.Fatal("the fixture is wrong: the member could read a restricted document")
		}
	}

	// delete: a purge the member could never read.
	if _, err := w.f.pool.Exec(w.f.ctx, `DELETE FROM documents WHERE id = $1`, toDelete.ID); err != nil {
		t.Fatal(err)
	}
	w.auditChange(t, "document.deleted", toDelete.ID)
	// revoke: someone else's share ends.
	if err := w.f.svc.RevokeDocumentShare(w.f.ctx, Human(w.tn.owner.ID), toRevoke.ID, otherShare.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	// demotion: the prior visibility was already restricted (the synthetic row
	// shape a document-level settings command must write; no such command
	// exists on this root yet).
	insertRow(t, w.f.ctx, w.f.pool, "audit_events", map[string]any{
		"id": util.NewID(), "organization_id": w.tn.orgID, "workspace_id": w.tn.wsA,
		"actor_kind": "human", "actor_id": w.tn.owner.ID, "action": "document.settings_changed",
		"resource_type": "document", "resource_id": toDemote.ID, "correlation_id": util.NewID(),
		"metadata": `{"visibility":"restricted"}`,
	})
	// move-away: the document leaves the workspace.
	if _, err := w.f.pool.Exec(w.f.ctx, `UPDATE documents SET workspace_id = $2 WHERE id = $1`, toMove.ID, w.tn.wsB); err != nil {
		t.Fatal(err)
	}
	w.auditChange(t, "document.moved", toMove.ID)

	for _, r := range w.drainFeed(t, feedCursor, 200) {
		switch r.DocumentID {
		case toDelete.ID, toRevoke.ID, toDemote.ID, toMove.ID:
			t.Fatalf("a never-reader received a row about %s: %+v", r.DocumentID, r)
		}
	}
}

// TestDocumentChangesFeedStillReaderKeepsReadingOnOneShareRevoke: revoking one
// of two shares must not take the document away from a caller who still reads
// through the other path (BE-G1-2): no removal, the ordinary upsert. The two
// paths are DIFFERENT principals - a user share to the member and a workspace
// share to wsA (which the member is in) - so document_shares' live unique index
// (document_id, principal_type, principal_id) is not violated.
func TestDocumentChangesFeedStillReaderKeepsReadingOnOneShareRevoke(t *testing.T) {
	w := newFeedWorld(t, "chgstill")
	doc := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "restricted", createdBy: w.tn.owner.ID})
	userShare := w.f.share(t, doc, DocumentPrincipalUser, w.tn.member.ID, DocumentLevelView, w.tn.owner.ID)
	w.f.share(t, doc, DocumentPrincipalWorkspace, w.tn.wsA, DocumentLevelView, w.tn.owner.ID)
	feedCursor, held := w.snapshotThenFeed(t, 200)
	if !held[doc.ID] {
		t.Fatal("the fixture is wrong: the member could not read the shared document")
	}

	// One of the two paths ends; the member still reads through the other.
	if err := w.f.svc.RevokeDocumentShare(w.f.ctx, Human(w.tn.owner.ID), doc.ID, userShare.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	got, ok := feedRowsByDoc(w.drainFeed(t, feedCursor, 200))[doc.ID]
	if !ok {
		t.Fatal("the revoke of one share did not reach the feed at all")
	}
	if got.ChangeKind != DocumentChangeKindUpsert || got.Removal != "" {
		t.Fatalf("still-reader row = %+v, want an upsert (never a removal)", got)
	}
}

// TestDocumentChangesFeedSavedSnapshotCursorServesUpsertsAndRemovals is the
// Advisor's fork-G5-04 case: a saved G5-01a end-of-snapshot cursor (minted by
// the real snapshot path to its last page) is served incrementally with BOTH
// an upsert and a removal.
func TestDocumentChangesFeedSavedSnapshotCursorServesUpsertsAndRemovals(t *testing.T) {
	w := newFeedWorld(t, "chgsaved")
	old := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "restricted", createdBy: w.tn.owner.ID})
	oldShare := w.f.share(t, old, DocumentPrincipalUser, w.tn.member.ID, DocumentLevelView, w.tn.owner.ID)
	feedCursor, held := w.snapshotThenFeed(t, 200)
	if !held[old.ID] {
		t.Fatal("the fixture is wrong: the member could not read the shared document")
	}

	// An upsert: a document granted after the snapshot.
	fresh := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "restricted", createdBy: w.tn.owner.ID})
	if _, err := w.f.svc.ShareDocument(w.f.ctx, Human(w.tn.owner.ID), fresh.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: w.tn.member.ID, Level: DocumentLevelView,
	}); err != nil {
		t.Fatalf("share: %v", err)
	}
	// A removal: the saved share on the older document ends.
	if err := w.f.svc.RevokeDocumentShare(w.f.ctx, Human(w.tn.owner.ID), old.ID, oldShare.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	rows := feedRowsByDoc(w.drainFeed(t, feedCursor, 200))
	if got, ok := rows[fresh.ID]; !ok || got.ChangeKind != DocumentChangeKindUpsert {
		t.Fatalf("saved cursor upsert = %+v (found %v), want an upsert", got, ok)
	}
	if got, ok := rows[old.ID]; !ok || got.ChangeKind != DocumentChangeKindRemoval || got.Removal != DocumentChangeRemovalPermissionRevoked {
		t.Fatalf("saved cursor removal = %+v (found %v), want the ids-only removal", got, ok)
	}
}

// TestDocumentChangesFeedVisibilityDemotionIsRemoval: a workspace-visible
// document demoted to restricted reaches the member who could read it through
// the workspace leg. The demotion is driven by the REAL command: an
// administrator who is NOT the feed caller PATCHes Visibility through
// UpdateDocument (BE-G2-1), which writes document.updated with a
// changes.visibility {from,to} diff. The member is not the ACL owner, so
// losing the workspace leg really takes their read away.
func TestDocumentChangesFeedVisibilityDemotionIsRemoval(t *testing.T) {
	w := newFeedWorld(t, "chgdemote")
	doc := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "workspace", createdBy: w.tn.owner.ID, aclOwner: w.tn.owner.ID})
	feedCursor, held := w.snapshotThenFeed(t, 200)
	if !held[doc.ID] {
		t.Fatal("the fixture is wrong: the member could not read the document")
	}

	restricted := documentVisibilityRestricted
	if _, err := w.f.svc.UpdateDocument(w.f.ctx, Human(w.tn.owner.ID), doc.ID, UpdateDocumentInput{
		Revision: doc.Revision, Visibility: &restricted,
	}); err != nil {
		t.Fatalf("demote via UpdateDocument: %v", err)
	}
	got, ok := feedRowsByDoc(w.drainFeed(t, feedCursor, 200))[doc.ID]
	if !ok || got.ChangeKind != DocumentChangeKindRemoval || got.Removal != DocumentChangeRemovalPermissionRevoked {
		t.Fatalf("demotion row = %+v (found %v), want removal permission_revoked", got, ok)
	}
}

// TestDocumentChangesFeedTitleEditOfUnreadableDocumentIsNotARemoval is the
// negative half of BE-G2-1: a document.updated row WITHOUT a visibility diff
// (a title edit) is not a removal basis. The member cannot read the document
// and must get no row about it - and, above all, no 410: a plain edit of a
// document they cannot read must never force a resync.
func TestDocumentChangesFeedTitleEditOfUnreadableDocumentIsNotARemoval(t *testing.T) {
	w := newFeedWorld(t, "chgtitleedit")
	hidden := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "restricted", createdBy: w.tn.owner.ID, aclOwner: w.tn.owner.ID})
	feedCursor, held := w.snapshotThenFeed(t, 200)
	if held[hidden.ID] {
		t.Fatal("the fixture is wrong: the member could read a restricted document")
	}

	title := "renamed by the owner"
	if _, err := w.f.svc.UpdateDocument(w.f.ctx, Human(w.tn.owner.ID), hidden.ID, UpdateDocumentInput{
		Revision: hidden.Revision, Title: &title,
	}); err != nil {
		t.Fatalf("title PATCH: %v", err)
	}
	for _, r := range w.drainFeed(t, feedCursor, 200) {
		if r.DocumentID == hidden.ID {
			t.Fatalf("a title-only edit produced a row about a document the member cannot read: %+v", r)
		}
	}
}

// demoteForRemovalProbe builds the shared BE-G3-1 fixture: a workspace-visible
// document whose ACL owner is the owner (NOT the feed caller), a snapshot the
// member can read it in, and then a demotion of the live row to restricted.
// The member is neither the ACL owner nor a share principal, so they cannot
// read the document any more and resolveFeedRow reaches removalByAudit for the
// synthetic audit row each case appends.
func (w *feedWorld) demoteForRemovalProbe(t *testing.T) (db.Document, string) {
	t.Helper()
	doc := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "workspace", createdBy: w.tn.owner.ID, aclOwner: w.tn.owner.ID})
	feedCursor, held := w.snapshotThenFeed(t, 200)
	if !held[doc.ID] {
		t.Fatal("the fixture is wrong: the member could not read the workspace-visible document")
	}
	// The demotion itself: the live row stops admitting the workspace leg. The
	// audit row the case appends is the only evidence of what the prior
	// visibility was, so the removal decision rests entirely on it.
	if _, err := w.f.pool.Exec(w.f.ctx, `UPDATE documents SET visibility = 'restricted' WHERE id = $1`, doc.ID); err != nil {
		t.Fatal(err)
	}
	return doc, feedCursor
}

// TestDocumentChangesFeedVisibilityDiffWithoutAPriorIs410 is BE-G3-1(a): a
// document.updated row carrying a changes.visibility diff whose prior value is
// missing (no from/before) and with no metadata.visibility fallback cannot prove
// whether the caller lost a level, so the feed answers 410
// change_cursor_expired - never a silent skip. A silent skip here would drop
// the demotion for a caller who could read the document before it.
func TestDocumentChangesFeedVisibilityDiffWithoutAPriorIs410(t *testing.T) {
	w := newFeedWorld(t, "chgvisnoprior")
	doc, feedCursor := w.demoteForRemovalProbe(t)

	// The real UpdateDocument PATCH writes document.updated with a
	// changes.visibility {from,to} diff; this row carries only the target, the
	// shape a partial writer would leave behind.
	insertRow(t, w.f.ctx, w.f.pool, "audit_events", map[string]any{
		"id": util.NewID(), "organization_id": w.tn.orgID, "workspace_id": w.tn.wsA,
		"actor_kind": "human", "actor_id": w.tn.owner.ID, "action": "document.updated",
		"resource_type": "document", "resource_id": doc.ID, "correlation_id": util.NewID(),
		"changes": `{"visibility":{"to":"restricted"}}`,
	})

	if _, err := w.list(t, w.tn.member.ID, feedCursor, 200); !codedIs(err, "change_cursor_expired") {
		t.Fatalf("a visibility diff with no prior = %v, want 410 change_cursor_expired (never a silent skip)", err)
	}
}

// TestDocumentChangesFeedSettingsChangedWithWorkspacePriorIsRemoval is
// BE-G3-1(b): the retained document.settings_changed arm with a prior
// visibility of workspace admits the member, so the demotion is the ids-only
// removal permission_revoked. Replacing this branch with a silent skip would
// leave the caller holding a document they can no longer read.
func TestDocumentChangesFeedSettingsChangedWithWorkspacePriorIsRemoval(t *testing.T) {
	w := newFeedWorld(t, "chgsetsprior")
	doc, feedCursor := w.demoteForRemovalProbe(t)

	// The shape a document-level settings command writes: metadata.visibility
	// carries the prior value.
	insertRow(t, w.f.ctx, w.f.pool, "audit_events", map[string]any{
		"id": util.NewID(), "organization_id": w.tn.orgID, "workspace_id": w.tn.wsA,
		"actor_kind": "human", "actor_id": w.tn.owner.ID, "action": "document.settings_changed",
		"resource_type": "document", "resource_id": doc.ID, "correlation_id": util.NewID(),
		"metadata": `{"visibility":"workspace"}`,
	})

	got, ok := feedRowsByDoc(w.drainFeed(t, feedCursor, 200))[doc.ID]
	if !ok {
		t.Fatal("a settings change whose prior visibility admitted the member produced no row")
	}
	if got.ChangeKind != DocumentChangeKindRemoval || got.Removal != DocumentChangeRemovalPermissionRevoked {
		t.Fatalf("settings removal row = %+v, want removal permission_revoked", got)
	}
}

// TestDocumentChangesFeedSettingsChangedWithoutAPriorIs410 is BE-G3-1(c): the
// same retained arm with no reconstructable prior visibility answers 410
// change_cursor_expired instead of guessing, exactly as the document.updated
// diff does. A silent skip would lose a removal the caller may be owed.
func TestDocumentChangesFeedSettingsChangedWithoutAPriorIs410(t *testing.T) {
	w := newFeedWorld(t, "chgsetsprior2")
	doc, feedCursor := w.demoteForRemovalProbe(t)

	// No metadata and no changes: the prior visibility cannot be
	// reconstructed.
	insertRow(t, w.f.ctx, w.f.pool, "audit_events", map[string]any{
		"id": util.NewID(), "organization_id": w.tn.orgID, "workspace_id": w.tn.wsA,
		"actor_kind": "human", "actor_id": w.tn.owner.ID, "action": "document.settings_changed",
		"resource_type": "document", "resource_id": doc.ID, "correlation_id": util.NewID(),
	})

	if _, err := w.list(t, w.tn.member.ID, feedCursor, 200); !codedIs(err, "change_cursor_expired") {
		t.Fatalf("a settings change with no prior = %v, want 410 change_cursor_expired (never a silent skip)", err)
	}
}
