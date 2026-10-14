package service

// G8-04 (UNI-1399): anchors by version, on the real database - the create
// with anchor + base_version_id and the five PUT rules of contract-collab
// section 4.3: version lookup inside the tenant + document, ordinal
// comparison (never ULID order), exact only at head, self idempotency and
// one audit + outbox row per call that changed a row.

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// anchorMimes maps each anchorable format to the mime a file version
// snapshots; the anchor rule reads the document's format from it.
var anchorMimes = map[string]string{
	"docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"pdf":  "application/pdf",
}

// anchorDoc makes a file document with versions 1..head, each carrying the
// format's mime, and points the document at the head like a save commit does.
func (f *docPermFixture) anchorDoc(t *testing.T, tn docTenant, format string, head int) (db.Document, []db.DocumentVersion) {
	t.Helper()
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	if _, err := f.pool.Exec(f.ctx, "UPDATE documents SET kind = 'file', content = NULL WHERE id = $1", d.ID); err != nil {
		t.Fatal(err)
	}
	versions := make([]db.DocumentVersion, 0, head)
	for n := 1; n <= head; n++ {
		insertRow(t, f.ctx, f.pool, "document_versions", map[string]any{
			"id": util.NewID(), "organization_id": d.OrganizationID, "workspace_id": d.WorkspaceID,
			"document_id": d.ID, "version": n, "kind": "file", "reason": "upload",
			"file_id": "01J8X4FILEN1P2Q3R4S5T6U7V8", "mime_type": anchorMimes[format],
			"created_by": d.CreatedBy, "created_by_kind": "human",
		})
		v, err := f.q.GetDocumentVersion(f.ctx, db.GetDocumentVersionParams{
			OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID, DocumentID: d.ID, Version: int32(n),
		})
		if err != nil {
			t.Fatal(err)
		}
		versions = append(versions, v)
	}
	if _, err := f.pool.Exec(f.ctx, "UPDATE documents SET current_version = $1, file_version_id = $2 WHERE id = $3",
		head, versions[head-1].ID, d.ID); err != nil {
		t.Fatal(err)
	}
	reloaded, err := f.q.GetDocumentByID(f.ctx, d.ID)
	if err != nil {
		t.Fatal(err)
	}
	return reloaded, versions
}

// anchorRaw renders one valid anchor of the format with over applied last.
func anchorRaw(format string, over map[string]any) json.RawMessage {
	var base map[string]any
	switch format {
	case "docx":
		base = map[string]any{"format": "docx", "v": 1, "path": []int{3, 0}, "start": 12, "end": 40, "quote": "doanh thu quý 3", "prefix": "Theo ", "suffix": " tăng"}
	case "xlsx":
		base = map[string]any{"format": "xlsx", "v": 1, "sheet": "S1", "range": "B7"}
	case "pptx":
		base = map[string]any{"format": "pptx", "v": 1, "slide_id": "257", "slide_index": 4}
	case "pdf":
		base = map[string]any{"format": "pdf", "v": 1, "page": 2, "rect": []float64{72, 540, 300, 560}}
	}
	for k, v := range over {
		base[k] = v
	}
	raw, err := json.Marshal(base)
	if err != nil {
		panic(err)
	}
	return raw
}

// anchorRefusalBody is the comparable shape of one refusal across cases.
type anchorRefusalBody struct {
	code   string
	status int
	msg    string
}

// anchorRefusal extracts the (code, status, message) every refusal carries;
// the service answers ValidationError (invalid_request) or CodedError.
func anchorRefusal(t *testing.T, err error) (string, int, string) {
	t.Helper()
	var ce CodedError
	if errors.As(err, &ce) {
		return ce.Code, ce.Status, ce.Msg
	}
	var ve ValidationError
	if errors.As(err, &ve) {
		return "invalid_request", 400, ve.Msg
	}
	t.Fatalf("error = %v, want CodedError or ValidationError", err)
	return "", 0, ""
}

func anchorCountRows(t *testing.T, f *docPermFixture, query string, args ...any) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx, query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func anchorAuditCount(t *testing.T, f *docPermFixture, documentID string) int {
	t.Helper()
	return anchorCountRows(t, f, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionDocumentCommentAnchorsUpdated, documentID)
}

func anchorOutboxCount(t *testing.T, f *docPermFixture, documentID string) int {
	t.Helper()
	return anchorCountRows(t, f, `SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'document_id' = $2`,
		audit.ActionDocumentCommentAnchorsUpdated, documentID)
}

// anchoredCreate posts one anchored root comment through the real service.
func (f *docPermFixture) anchoredCreate(t *testing.T, actor Actor, d db.Document, versionID, anchor string, key string) db.DocumentComment {
	t.Helper()
	c, err := f.svc.AddDocumentComment(f.ctx, actor, d.ID, AddCommentInput{
		Body: "có neo", CommentType: "comment", Anchor: json.RawMessage(anchor), BaseVersionID: versionID,
	}, key)
	if err != nil {
		t.Fatalf("anchored create: %v", err)
	}
	return c
}

// The create binds anchor + base_version_id: stale on a version older than
// head, exact only at head, one 400 anchor_version_invalid with the same
// body for every unresolvable version, and a fingerprint that tells two
// anchors apart under one Idempotency-Key.
func TestDocumentCommentAnchorsCreate(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "anchor-create")
	d, versions := f.anchorDoc(t, tn, "xlsx", 3)
	member := Human(tn.member.ID)

	// Older than head: stale, and the row keeps the version it was written
	// against.
	stale := f.anchoredCreate(t, member, d, versions[0].ID, string(anchorRaw("xlsx", nil)), "")
	if !stale.AnchorVersionID.Valid || stale.AnchorVersionID.String != versions[0].ID ||
		!stale.AnchorState.Valid || stale.AnchorState.String != "stale" || len(stale.Anchor) == 0 {
		t.Fatalf("stale create = %+v", stale)
	}
	// At head: exact.
	exact := f.anchoredCreate(t, member, d, versions[2].ID, string(anchorRaw("xlsx", nil)), "")
	if !exact.AnchorState.Valid || exact.AnchorState.String != "exact" {
		t.Fatalf("head create state = %+v", exact.AnchorState)
	}

	// Same body, different anchor, no key: two rows and the first one keeps
	// its anchor - nothing replays.
	other := f.anchoredCreate(t, member, d, versions[2].ID, string(anchorRaw("xlsx", map[string]any{"range": "B8"})), "")
	if other.ID == exact.ID {
		t.Fatal("a second anchored create replayed the first")
	}
	firstRow, err := f.q.GetDocumentComment(f.ctx, db.GetDocumentCommentParams{
		ID: exact.ID, OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(firstRow.Anchor), `"B7"`) {
		t.Fatalf("first anchor changed: %s", firstRow.Anchor)
	}

	// One key, two anchors: 409 idempotency_payload_mismatch, never a replay
	// of the other anchor. The same key and payload replays.
	key := util.NewID()
	kept := f.anchoredCreate(t, member, d, versions[2].ID, string(anchorRaw("xlsx", nil)), key)
	if _, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{
		Body: "có neo", CommentType: "comment",
		Anchor: json.RawMessage(anchorRaw("xlsx", map[string]any{"range": "B9"})), BaseVersionID: versions[2].ID,
	}, key); err == nil {
		t.Fatal("same key with a different anchor was accepted")
	} else {
		collabWantCode(t, err, "idempotency_payload_mismatch")
	}
	replayed := f.anchoredCreate(t, member, d, versions[2].ID, string(anchorRaw("xlsx", nil)), key)
	if replayed.ID != kept.ID {
		t.Fatalf("replay = %s, want %s", replayed.ID, kept.ID)
	}
	if n := anchorCountRows(t, f, `SELECT count(*) FROM document_comments WHERE document_id = $1`, d.ID); n != 4 {
		t.Fatalf("comment rows = %d, want 4", n)
	}

	// R3-1: the fingerprint also binds base_version_id, so one key with the
	// same body and anchor but a different valid base version is a mismatch,
	// never a replay of the comment bound to the first version. Without it a
	// retry could answer a comment pinned to the wrong version.
	versionKey := util.NewID()
	bound := f.anchoredCreate(t, member, d, versions[0].ID, string(anchorRaw("xlsx", nil)), versionKey)
	if _, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{
		Body: "có neo", CommentType: "comment",
		Anchor: json.RawMessage(anchorRaw("xlsx", nil)), BaseVersionID: versions[2].ID,
	}, versionKey); err == nil {
		t.Fatal("same key with a different base_version_id was accepted")
	} else {
		collabWantCode(t, err, "idempotency_payload_mismatch")
	}
	if n := anchorCountRows(t, f, `SELECT count(*) FROM document_comments WHERE document_id = $1`, d.ID); n != 5 {
		t.Fatalf("comment rows after version mismatch = %d, want 5", n)
	}
	// The same key and payload still replays the first version's comment.
	replayedBound := f.anchoredCreate(t, member, d, versions[0].ID, string(anchorRaw("xlsx", nil)), versionKey)
	if replayedBound.ID != bound.ID {
		t.Fatalf("version replay = %s, want %s", replayedBound.ID, bound.ID)
	}

	// The unresolvable versions share one refusal body and write nothing:
	// an unknown id and another document's version.
	d2, v2 := f.anchorDoc(t, tn, "xlsx", 1)
	before := anchorCountRows(t, f, `SELECT count(*) FROM document_comments WHERE document_id = $1`, d.ID)
	var bodies []anchorRefusalBody
	for _, versionID := range []string{"01J8X4VER0N1P2Q3R4S5T6U7V8", v2[0].ID} {
		_, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{
			Body: "neo lạ", CommentType: "comment", Anchor: json.RawMessage(anchorRaw("xlsx", nil)), BaseVersionID: versionID,
		}, "")
		if err == nil {
			t.Fatalf("unresolvable version %q accepted", versionID)
		}
		code, status, msg := anchorRefusal(t, err)
		if code != "anchor_version_invalid" || status != 400 {
			t.Fatalf("version %q = %d %s, want 400 anchor_version_invalid", versionID, status, code)
		}
		bodies = append(bodies, anchorRefusalBody{code, status, msg})
	}
	for _, b := range bodies[1:] {
		if b.msg != bodies[0].msg || b.status != bodies[0].status {
			t.Fatalf("refusal bodies differ: %+v vs %+v", bodies[0], b)
		}
	}
	if after := anchorCountRows(t, f, `SELECT count(*) FROM document_comments WHERE document_id = $1`, d.ID); after != before {
		t.Fatalf("failed creates wrote rows: %d -> %d", before, after)
	}
	if n := anchorCountRows(t, f, `SELECT count(*) FROM document_comments WHERE document_id = $1`, d2.ID); n != 0 {
		t.Fatalf("failed creates wrote on the other document: %d", n)
	}

	// An anchor belongs to a root kind=comment only, needs its base version,
	// matches the document's format and must pass the closed schema.
	// OQ-C2: a root kind=comment now requires an anchor and a base version,
	// so the parent the reply case answers is anchored (the anchorless root
	// is a 400 pinned by TestDocumentCommentCollab).
	root := f.anchoredCreate(t, member, d, versions[2].ID, string(anchorRaw("xlsx", nil)), "")
	badBodies := []AddCommentInput{
		{Body: "trả lời", CommentType: "comment", ParentID: &root.ID, Anchor: anchorRaw("xlsx", nil), BaseVersionID: versions[2].ID},
		{Body: "thảo luận", CommentType: "discussion", Anchor: anchorRaw("xlsx", nil), BaseVersionID: versions[2].ID},
		{Body: "mặc định", CommentType: "", Anchor: anchorRaw("xlsx", nil), BaseVersionID: versions[2].ID},
		{Body: "thiếu version", CommentType: "comment", Anchor: anchorRaw("xlsx", nil)},
		{Body: "khác định dạng", CommentType: "comment", Anchor: anchorRaw("docx", nil), BaseVersionID: versions[2].ID},
		{Body: "khóa lạ", CommentType: "comment", Anchor: anchorRaw("xlsx", map[string]any{"color": "red"}), BaseVersionID: versions[2].ID},
		{Body: "quá trần", CommentType: "comment", Anchor: anchorRaw("xlsx", map[string]any{"sheet": strings.Repeat("s", 5000)}), BaseVersionID: versions[2].ID},
		{Body: "v sai", CommentType: "comment", Anchor: anchorRaw("xlsx", map[string]any{"v": 2}), BaseVersionID: versions[2].ID},
		{Body: "thiếu trường", CommentType: "comment", Anchor: json.RawMessage(`{"format":"xlsx","v":1,"sheet":"S1"}`), BaseVersionID: versions[2].ID},
	}
	for i, in := range badBodies {
		if _, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, in, ""); err == nil {
			t.Fatalf("bad anchored create %d accepted", i)
		} else if code, status, _ := anchorRefusal(t, err); code != "invalid_request" || status != 400 {
			t.Fatalf("bad anchored create %d = %d %s", i, status, code)
		}
	}

	// A page cannot carry anchors (G8-D6): markdown/HTML have no anchor model.
	// The version resolves (so this is the format rule answering, not the
	// version lookup).
	page := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	pageVersion := f.version(t, page, 1, "manual", "")
	if _, err := f.svc.AddDocumentComment(f.ctx, member, page.ID, AddCommentInput{
		Body: "neo trang", CommentType: "comment", Anchor: anchorRaw("xlsx", nil), BaseVersionID: pageVersion.ID,
	}, ""); err == nil {
		t.Fatal("a page accepted an anchor")
	} else if code, status, _ := anchorRefusal(t, err); code != "invalid_request" || status != 400 {
		t.Fatalf("page anchor = %d %s", status, code)
	}
}

// The PUT applies the editor's map by rule: never back to an older version,
// exact only at head, lost stays lost, a repeated payload changes no row and
// the changed ones move the list_token exactly once.
func TestDocumentCommentAnchorsPut(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "anchor-put")
	d, versions := f.anchorDoc(t, tn, "xlsx", 3)
	member := Human(tn.member.ID)
	comment := f.anchoredCreate(t, member, d, versions[0].ID, string(anchorRaw("xlsx", map[string]any{"range": "B7"})), "")

	readRow := func() db.DocumentComment {
		t.Helper()
		row, err := f.q.GetDocumentComment(f.ctx, db.GetDocumentCommentParams{
			ID: comment.ID, OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID,
		})
		if err != nil {
			t.Fatal(err)
		}
		return row
	}
	put := func(versionID string, anchor string, state string) DocumentCommentAnchorResult {
		t.Helper()
		res, err := f.svc.PutDocumentCommentAnchors(f.ctx, member, d.ID, DocumentCommentAnchorsInput{
			AnchorsPresent: true,
			VersionID:      versionID,
			Anchors:        []DocumentCommentAnchorItem{{CommentID: comment.ID, Anchor: json.RawMessage(anchor), State: state}},
		})
		if err != nil {
			t.Fatalf("PUT anchors at %s: %v", versionID, err)
		}
		return res
	}

	// Newer than the anchor's version but not head: accepted and stale.
	res := put(versions[1].ID, string(anchorRaw("xlsx", map[string]any{"range": "B8"})), "exact")
	if len(res.Updated) != 1 || res.Updated[0] != comment.ID || len(res.Skipped) != 0 || !strings.HasPrefix(res.ListToken, "lt1:") {
		t.Fatalf("first PUT = %+v", res)
	}
	row := readRow()
	if row.AnchorVersionID.String != versions[1].ID || row.AnchorState.String != "stale" ||
		!strings.Contains(string(row.Anchor), `"B8"`) {
		t.Fatalf("after PUT v2 = %+v", row)
	}

	// Head: exact.
	resHead := put(versions[2].ID, string(anchorRaw("xlsx", map[string]any{"range": "B8"})), "exact")
	if len(resHead.Updated) != 1 || readRow().AnchorState.String != "exact" {
		t.Fatalf("PUT at head = %+v", resHead)
	}
	if resHead.ListToken == res.ListToken {
		t.Fatal("the list_token did not move after a real change")
	}

	// Same payload twice: no row moves, one event, same token.
	before := readRow()
	audits, outboxes := anchorAuditCount(t, f, d.ID), anchorOutboxCount(t, f, d.ID)
	repeat := put(versions[2].ID, string(anchorRaw("xlsx", map[string]any{"range": "B8"})), "exact")
	after := readRow()
	if len(repeat.Updated) != 0 || len(repeat.Skipped) != 0 || repeat.ListToken != resHead.ListToken {
		t.Fatalf("repeat PUT = %+v", repeat)
	}
	if !after.UpdatedAt.Time.Equal(before.UpdatedAt.Time) {
		t.Fatalf("repeat PUT bumped updated_at: %v -> %v", before.UpdatedAt.Time, after.UpdatedAt.Time)
	}
	if n := anchorAuditCount(t, f, d.ID); n != audits {
		t.Fatalf("repeat PUT wrote an audit row: %d -> %d", audits, n)
	}
	if n := anchorOutboxCount(t, f, d.ID); n != outboxes {
		t.Fatalf("repeat PUT wrote an outbox row: %d -> %d", outboxes, n)
	}

	// An older version is skipped and the stored anchor does not move back.
	stale := put(versions[0].ID, string(anchorRaw("xlsx", map[string]any{"range": "B1"})), "exact")
	if len(stale.Updated) != 0 || len(stale.Skipped) != 1 || stale.Skipped[0].Reason != "older_version" {
		t.Fatalf("older version PUT = %+v", stale)
	}
	if row := readRow(); row.AnchorVersionID.String != versions[2].ID || strings.Contains(string(row.Anchor), `"B1"`) {
		t.Fatalf("a skipped PUT moved the anchor: %+v", row)
	}

	// lost keeps the comment and its body; the list carries the flag.
	lost := put(versions[2].ID, string(anchorRaw("xlsx", map[string]any{"range": "B8"})), "lost")
	if len(lost.Updated) != 1 {
		t.Fatalf("lost PUT = %+v", lost)
	}
	row = readRow()
	if row.AnchorState.String != "lost" || row.Body == "" {
		t.Fatalf("lost row = %+v", row)
	}
	list, err := f.svc.DocumentComments(f.ctx, member, d.ID, DocumentCommentListInput{})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, r := range list.Rows {
		if r.ID == comment.ID {
			found = true
			if !r.AnchorState.Valid || r.AnchorState.String != "lost" {
				t.Fatalf("list state = %+v", r.AnchorState)
			}
		}
	}
	if !found {
		t.Fatal("the lost comment fell out of the list")
	}

	// One version_id lookup, one body: unknown, another document's and empty.
	d2, v2 := f.anchorDoc(t, tn, "xlsx", 1)
	beforeRows := anchorCountRows(t, f, `SELECT count(*) FROM document_comments WHERE document_id = $1`, d2.ID)
	var bodies []anchorRefusalBody
	for _, versionID := range []string{"01J8X4VER0N1P2Q3R4S5T6U7V8", v2[0].ID, ""} {
		_, err := f.svc.PutDocumentCommentAnchors(f.ctx, member, d.ID, DocumentCommentAnchorsInput{
			AnchorsPresent: true,
			VersionID:      versionID, Anchors: []DocumentCommentAnchorItem{{CommentID: comment.ID, Anchor: anchorRaw("xlsx", nil), State: "exact"}},
		})
		if err == nil {
			t.Fatalf("unresolvable PUT version %q accepted", versionID)
		}
		code, status, msg := anchorRefusal(t, err)
		if code != "anchor_version_invalid" || status != 400 {
			t.Fatalf("PUT version %q = %d %s", versionID, status, code)
		}
		bodies = append(bodies, anchorRefusalBody{code, status, msg})
	}
	for _, b := range bodies[1:] {
		if b.msg != bodies[0].msg || b.status != bodies[0].status {
			t.Fatalf("PUT refusal bodies differ: %+v vs %+v", bodies[0], b)
		}
	}
	if after := anchorCountRows(t, f, `SELECT count(*) FROM document_comments WHERE document_id = $1`, d2.ID); after != beforeRows {
		t.Fatalf("failed PUT wrote rows: %d -> %d", beforeRows, after)
	}
	if row := readRow(); row.AnchorVersionID.String != versions[2].ID || row.AnchorState.String != "lost" {
		t.Fatalf("a failed PUT moved the anchor: %+v", row)
	}

	// Another document's comment is skipped with the shared reason, and its
	// row is untouched.
	otherComment := f.anchoredCreate(t, member, d2, v2[0].ID, string(anchorRaw("xlsx", nil)), "")
	resForeign, err := f.svc.PutDocumentCommentAnchors(f.ctx, member, d.ID, DocumentCommentAnchorsInput{
		AnchorsPresent: true,
		VersionID:      versions[2].ID,
		Anchors:        []DocumentCommentAnchorItem{{CommentID: otherComment.ID, Anchor: anchorRaw("xlsx", map[string]any{"range": "B8"}), State: "exact"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(resForeign.Updated) != 0 || len(resForeign.Skipped) != 1 || resForeign.Skipped[0].Reason != "not_applicable" {
		t.Fatalf("foreign comment PUT = %+v", resForeign)
	}
	foreignRow, err := f.q.GetDocumentComment(f.ctx, db.GetDocumentCommentParams{
		ID: otherComment.ID, OrganizationID: d2.OrganizationID, WorkspaceID: d2.WorkspaceID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if foreignRow.AnchorVersionID.String != v2[0].ID {
		t.Fatalf("the other document's comment moved: %+v", foreignRow)
	}

	// A discussion in the body is skipped the same way.
	discussion, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "thảo luận", CommentType: "discussion"}, "")
	if err != nil {
		t.Fatal(err)
	}
	resDiscussion, err := f.svc.PutDocumentCommentAnchors(f.ctx, member, d.ID, DocumentCommentAnchorsInput{
		AnchorsPresent: true,
		VersionID:      versions[2].ID,
		Anchors:        []DocumentCommentAnchorItem{{CommentID: discussion.ID, Anchor: anchorRaw("xlsx", nil), State: "exact"}},
	})
	if err != nil || len(resDiscussion.Updated) != 0 || len(resDiscussion.Skipped) != 1 {
		t.Fatalf("discussion PUT = %+v %v", resDiscussion, err)
	}

	// Schema and state refusals write nothing.
	badItems := []DocumentCommentAnchorItem{
		{CommentID: comment.ID, Anchor: anchorRaw("xlsx", map[string]any{"color": "red"}), State: "exact"},
		{CommentID: comment.ID, Anchor: anchorRaw("docx", nil), State: "exact"},
		{CommentID: comment.ID, Anchor: anchorRaw("xlsx", map[string]any{"sheet": strings.Repeat("s", 5000)}), State: "exact"},
		{CommentID: comment.ID, Anchor: anchorRaw("xlsx", nil), State: "maybe"},
		{CommentID: comment.ID, Anchor: json.RawMessage(`null`), State: "exact"},
	}
	for i, item := range badItems {
		if _, err := f.svc.PutDocumentCommentAnchors(f.ctx, member, d.ID, DocumentCommentAnchorsInput{
			AnchorsPresent: true,
			VersionID:      versions[2].ID, Anchors: []DocumentCommentAnchorItem{item},
		}); err == nil {
			t.Fatalf("bad PUT item %d accepted", i)
		} else if code, status, _ := anchorRefusal(t, err); code != "invalid_request" || status != 400 {
			t.Fatalf("bad PUT item %d = %d %s", i, status, code)
		}
	}
	if row := readRow(); row.AnchorState.String != "lost" {
		t.Fatalf("a refused item wrote: %+v", row)
	}

	// The event payload carries ids only: the document, the workspace and the
	// version of the write it belongs to.
	var payload string
	if err := f.pool.QueryRow(f.ctx, `SELECT payload FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'document_id' = $2 ORDER BY created_at DESC, id DESC LIMIT 1`,
		audit.ActionDocumentCommentAnchorsUpdated, d.ID).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(payload), &decoded); err != nil {
		t.Fatal(err)
	}
	versionIDs := map[string]bool{versions[0].ID: true, versions[1].ID: true, versions[2].ID: true}
	if len(decoded) != 3 || decoded["document_id"] != d.ID || decoded["workspace_id"] != d.WorkspaceID ||
		!versionIDs[decoded["version_id"].(string)] {
		t.Fatalf("event payload = %v", decoded)
	}
}

// anchorDocReverseIDs makes a file document whose versions 1..head carry the
// format's mime but whose ULIDs run in reverse: version 1 gets the lexically
// LARGEST id and version head the smallest. A comparison that used ULID string
// order instead of the ordinal would therefore pick the wrong side, which is
// exactly what R1-4 asks the ordinal rule to be distinguished by.
func (f *docPermFixture) anchorDocReverseIDs(t *testing.T, tn docTenant, format string, head int) (db.Document, []db.DocumentVersion) {
	t.Helper()
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	if _, err := f.pool.Exec(f.ctx, "UPDATE documents SET kind = 'file', content = NULL WHERE id = $1", d.ID); err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 0, head)
	for n := 1; n <= head; n++ {
		ids = append(ids, util.NewID())
	}
	// Reverse the ids: the highest ordinal takes the smallest id.
	for i, j := 0, len(ids)-1; i < j; i, j = i+1, j-1 {
		ids[i], ids[j] = ids[j], ids[i]
	}
	versions := make([]db.DocumentVersion, 0, head)
	for n := 1; n <= head; n++ {
		insertRow(t, f.ctx, f.pool, "document_versions", map[string]any{
			"id": ids[n-1], "organization_id": d.OrganizationID, "workspace_id": d.WorkspaceID,
			"document_id": d.ID, "version": n, "kind": "file", "reason": "upload",
			"file_id": "01J8X4FILEN1P2Q3R4S5T6U7V8", "mime_type": anchorMimes[format],
			"created_by": d.CreatedBy, "created_by_kind": "human",
		})
		v, err := f.q.GetDocumentVersion(f.ctx, db.GetDocumentVersionParams{
			OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID, DocumentID: d.ID, Version: int32(n),
		})
		if err != nil {
			t.Fatal(err)
		}
		versions = append(versions, v)
	}
	if _, err := f.pool.Exec(f.ctx, "UPDATE documents SET current_version = $1, file_version_id = $2 WHERE id = $3",
		head, versions[head-1].ID, d.ID); err != nil {
		t.Fatal(err)
	}
	reloaded, err := f.q.GetDocumentByID(f.ctx, d.ID)
	if err != nil {
		t.Fatal(err)
	}
	return reloaded, versions
}

// anchorCanonical reduces a stored anchor to the canonical form the server
// writes, so an assertion can ignore the spelling jsonb hands back.
func anchorCanonical(t *testing.T, raw []byte) string {
	t.Helper()
	got, err := canonicalJSON(raw)
	if err != nil {
		t.Fatalf("canonical anchor: %v (%s)", err, raw)
	}
	return string(got)
}

// anchorReadRow reads one comment row for the assertions below.
func anchorReadRow(t *testing.T, f *docPermFixture, d db.Document, commentID string) db.DocumentComment {
	t.Helper()
	row, err := f.q.GetDocumentComment(f.ctx, db.GetDocumentCommentParams{
		ID: commentID, OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID,
	})
	if err != nil {
		t.Fatal(err)
	}
	return row
}

// anchorPut issues one single-item PUT through the real service; present marks
// the required anchors key as carried by the body.
func anchorPut(t *testing.T, f *docPermFixture, actor Actor, d db.Document, versionID, commentID, anchor, state string, present bool) (DocumentCommentAnchorResult, error) {
	t.Helper()
	return f.svc.PutDocumentCommentAnchors(f.ctx, actor, d.ID, DocumentCommentAnchorsInput{
		AnchorsPresent: present,
		VersionID:      versionID,
		Anchors:        []DocumentCommentAnchorItem{{CommentID: commentID, Anchor: json.RawMessage(anchor), State: state}},
	})
}

// R1-2: one accepted create or PUT per format with the stored canonical JSON
// pinned, plus one missing-required-field case per format. The earlier suite
// only ever drove xlsx, so a regression that rejected every valid docx, pptx
// or pdf anchor would have passed.
func TestDocumentCommentAnchorsFormats(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "anchor-formats")
	member := Human(tn.member.ID)

	cases := []struct {
		format    string
		canonical string
		missing   string
	}{
		{"docx", `{"end":40,"format":"docx","path":[3,0],"prefix":"Theo ","quote":"doanh thu quý 3","start":12,"suffix":" tăng","v":1}`, `{"format":"docx","v":1,"path":[3,0],"end":40,"quote":"q","prefix":"","suffix":""}`},
		{"pptx", `{"format":"pptx","slide_id":"257","slide_index":4,"v":1}`, `{"format":"pptx","v":1,"slide_index":4}`},
		{"pdf", `{"format":"pdf","page":2,"rect":[72,540,300,560],"v":1}`, `{"format":"pdf","v":1,"page":2}`},
	}
	for _, tc := range cases {
		d, versions := f.anchorDoc(t, tn, tc.format, 2)
		c := f.anchoredCreate(t, member, d, versions[0].ID, string(anchorRaw(tc.format, nil)), "")
		// jsonb hands the stored bytes back in its own spelling, so the
		// assertion is on the canonical form both sides reduce to.
		if got := anchorCanonical(t, c.Anchor); got != tc.canonical {
			t.Fatalf("%s stored canonical = %s, want %s", tc.format, got, tc.canonical)
		}
		// A PUT at head re-writes the same anchor and resolves exact.
		res, err := anchorPut(t, f, member, d, versions[1].ID, c.ID, string(anchorRaw(tc.format, nil)), "exact", true)
		if err != nil || len(res.Updated) != 1 {
			t.Fatalf("%s PUT = %+v %v", tc.format, res, err)
		}
		if row := anchorReadRow(t, f, d, c.ID); row.AnchorState.String != "exact" || anchorCanonical(t, row.Anchor) != tc.canonical {
			t.Fatalf("%s PUT row = %s %s", tc.format, row.AnchorState.String, row.Anchor)
		}
		// A missing required field is a 400 on create and on the PUT.
		if _, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{
			Body: "thiếu trường", CommentType: "comment", Anchor: json.RawMessage(tc.missing), BaseVersionID: versions[0].ID,
		}, ""); err == nil {
			t.Fatalf("%s create missing required accepted", tc.format)
		} else if code, status, _ := anchorRefusal(t, err); code != "invalid_request" || status != 400 {
			t.Fatalf("%s create missing required = %d %s", tc.format, status, code)
		}
		if _, err := anchorPut(t, f, member, d, versions[1].ID, c.ID, tc.missing, "exact", true); err == nil {
			t.Fatalf("%s PUT missing required accepted", tc.format)
		} else if code, status, _ := anchorRefusal(t, err); code != "invalid_request" || status != 400 {
			t.Fatalf("%s PUT missing required = %d %s", tc.format, status, code)
		}
	}
}

// R1-1: the same comment_id twice in one body is refused before anything is
// applied, so a repeat of that payload cannot keep moving the list_token.
func TestDocumentCommentAnchorsPutDuplicateComment(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "anchor-dup")
	d, versions := f.anchorDoc(t, tn, "xlsx", 2)
	member := Human(tn.member.ID)
	c := f.anchoredCreate(t, member, d, versions[0].ID, string(anchorRaw("xlsx", nil)), "")
	before := anchorReadRow(t, f, d, c.ID)
	audits, outboxes := anchorAuditCount(t, f, d.ID), anchorOutboxCount(t, f, d.ID)

	_, err := f.svc.PutDocumentCommentAnchors(f.ctx, member, d.ID, DocumentCommentAnchorsInput{
		AnchorsPresent: true,
		VersionID:      versions[1].ID,
		Anchors: []DocumentCommentAnchorItem{
			{CommentID: c.ID, Anchor: anchorRaw("xlsx", map[string]any{"range": "B8"}), State: "exact"},
			{CommentID: c.ID, Anchor: anchorRaw("xlsx", map[string]any{"range": "B9"}), State: "exact"},
		},
	})
	if err == nil {
		t.Fatal("a repeated comment_id was accepted")
	}
	if code, status, _ := anchorRefusal(t, err); code != "invalid_request" || status != 400 {
		t.Fatalf("duplicate comment_id = %d %s", status, code)
	}
	after := anchorReadRow(t, f, d, c.ID)
	if !after.UpdatedAt.Time.Equal(before.UpdatedAt.Time) || string(after.Anchor) != string(before.Anchor) {
		t.Fatalf("the refused duplicate wrote a row: %+v -> %+v", before, after)
	}
	if n := anchorAuditCount(t, f, d.ID); n != audits {
		t.Fatalf("refused duplicate wrote an audit row: %d -> %d", audits, n)
	}
	if n := anchorOutboxCount(t, f, d.ID); n != outboxes {
		t.Fatalf("refused duplicate wrote an outbox row: %d -> %d", outboxes, n)
	}
}

// R1-7: a lost report keeps the stored anchor bytes and the version they were
// written against; only anchor_state moves. A later lost item carrying a
// different anchor must not overwrite the last known position.
func TestDocumentCommentAnchorsPutLostKeepsAnchor(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "anchor-lost")
	d, versions := f.anchorDoc(t, tn, "xlsx", 3)
	member := Human(tn.member.ID)
	// Bind at the head so the stored anchor is exact and its bytes are known.
	c := f.anchoredCreate(t, member, d, versions[2].ID, string(anchorRaw("xlsx", map[string]any{"range": "B7"})), "")
	stored := anchorReadRow(t, f, d, c.ID)

	res, err := anchorPut(t, f, member, d, versions[2].ID, c.ID, string(anchorRaw("xlsx", map[string]any{"range": "Z9"})), "lost", true)
	if err != nil || len(res.Updated) != 1 {
		t.Fatalf("lost PUT = %+v %v", res, err)
	}
	row := anchorReadRow(t, f, d, c.ID)
	if row.AnchorState.String != "lost" {
		t.Fatalf("lost state = %q", row.AnchorState.String)
	}
	if row.AnchorVersionID.String != stored.AnchorVersionID.String {
		t.Fatalf("lost moved the anchor version: %s -> %s", stored.AnchorVersionID.String, row.AnchorVersionID.String)
	}
	if !strings.Contains(string(row.Anchor), `"B7"`) || strings.Contains(string(row.Anchor), `"Z9"`) {
		t.Fatalf("lost overwrote the stored anchor: %s", row.Anchor)
	}
	// The stored bytes are unchanged, not merely equal by meaning.
	if string(row.Anchor) != string(stored.Anchor) {
		t.Fatalf("lost rewrote the anchor bytes: %s -> %s", stored.Anchor, row.Anchor)
	}
}

// R1-8: anchors is required. A PUT that omits it (or sends null) is a 400 and
// writes nothing; an explicit [] stays the valid empty update.
func TestDocumentCommentAnchorsPutRequiresAnchorsField(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "anchor-required")
	d, versions := f.anchorDoc(t, tn, "xlsx", 2)
	member := Human(tn.member.ID)
	c := f.anchoredCreate(t, member, d, versions[1].ID, string(anchorRaw("xlsx", nil)), "")
	before := anchorReadRow(t, f, d, c.ID)
	for _, present := range []bool{false} {
		_, err := f.svc.PutDocumentCommentAnchors(f.ctx, member, d.ID, DocumentCommentAnchorsInput{
			AnchorsPresent: present, VersionID: versions[1].ID,
		})
		if err == nil {
			t.Fatal("a PUT without anchors was accepted")
		}
		if code, status, _ := anchorRefusal(t, err); code != "invalid_request" || status != 400 {
			t.Fatalf("absent anchors = %d %s", status, code)
		}
	}
	if after := anchorReadRow(t, f, d, c.ID); !after.UpdatedAt.Time.Equal(before.UpdatedAt.Time) {
		t.Fatal("a PUT without anchors wrote a row")
	}
	// [] is the valid empty update: 200, nothing changed.
	res, err := f.svc.PutDocumentCommentAnchors(f.ctx, member, d.ID, DocumentCommentAnchorsInput{
		AnchorsPresent: true, VersionID: versions[1].ID, Anchors: []DocumentCommentAnchorItem{},
	})
	if err != nil || len(res.Updated) != 0 || len(res.Skipped) != 0 || !strings.HasPrefix(res.ListToken, "lt1:") {
		t.Fatalf("empty update = %+v %v", res, err)
	}
}

// R1-9 / R1-10: a JSON null inside a required numeric array, a blank pptx
// slide_id and a present-but-blank object_id are all 400 - never a silent 0.
func TestDocumentCommentAnchorsPutRejectsNullAndBlank(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "anchor-null")
	member := Human(tn.member.ID)

	docx, dxVersions := f.anchorDoc(t, tn, "docx", 1)
	docxComment := f.anchoredCreate(t, member, docx, dxVersions[0].ID, string(anchorRaw("docx", nil)), "")
	pdf, pdfVersions := f.anchorDoc(t, tn, "pdf", 1)
	pdfComment := f.anchoredCreate(t, member, pdf, pdfVersions[0].ID, string(anchorRaw("pdf", nil)), "")
	pptx, pxVersions := f.anchorDoc(t, tn, "pptx", 1)
	pptxComment := f.anchoredCreate(t, member, pptx, pxVersions[0].ID, string(anchorRaw("pptx", nil)), "")

	bad := []struct {
		name   string
		doc    db.Document
		ver    string
		cid    string
		anchor string
	}{
		{"docx null path", docx, dxVersions[0].ID, docxComment.ID, `{"format":"docx","v":1,"path":[3,null],"start":0,"end":1,"quote":"q","prefix":"","suffix":""}`},
		{"pdf null rect", pdf, pdfVersions[0].ID, pdfComment.ID, `{"format":"pdf","v":1,"page":1,"rect":[72,null,300,560]}`},
		{"pptx blank slide_id", pptx, pxVersions[0].ID, pptxComment.ID, `{"format":"pptx","v":1,"slide_id":"  ","slide_index":0}`},
		{"pptx blank object_id", pptx, pxVersions[0].ID, pptxComment.ID, `{"format":"pptx","v":1,"slide_id":"257","slide_index":0,"object_id":" "}`},
	}
	for _, tc := range bad {
		before := anchorReadRow(t, f, tc.doc, tc.cid)
		if _, err := anchorPut(t, f, member, tc.doc, tc.ver, tc.cid, tc.anchor, "exact", true); err == nil {
			t.Fatalf("%s accepted", tc.name)
		} else if code, status, _ := anchorRefusal(t, err); code != "invalid_request" || status != 400 {
			t.Fatalf("%s = %d %s", tc.name, status, code)
		}
		if after := anchorReadRow(t, f, tc.doc, tc.cid); !after.UpdatedAt.Time.Equal(before.UpdatedAt.Time) {
			t.Fatalf("%s wrote a row", tc.name)
		}
	}
}

// R1-4: the ordinal rule is only distinguishable when a higher ordinal carries
// the lexically smaller ULID. A PUT at the lexically-larger-but-ordinal-lower
// version is skipped with older_version and the anchor does not move back.
func TestDocumentCommentAnchorsPutOrdinalNotULID(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "anchor-ordinal")
	d, versions := f.anchorDocReverseIDs(t, tn, "xlsx", 3)
	member := Human(tn.member.ID)
	// The reversed ids: version 1 has the largest id, version 3 the smallest.
	if !(versions[0].ID > versions[1].ID && versions[1].ID > versions[2].ID) {
		t.Fatalf("fixture ids not reversed: %s %s %s", versions[0].ID, versions[1].ID, versions[2].ID)
	}
	// Bind the anchor at version 2.
	c := f.anchoredCreate(t, member, d, versions[1].ID, string(anchorRaw("xlsx", map[string]any{"range": "B7"})), "")
	// version 1 has the lexically LARGEST id but the LOWER ordinal: skipped.
	res, err := anchorPut(t, f, member, d, versions[0].ID, c.ID, string(anchorRaw("xlsx", map[string]any{"range": "B1"})), "exact", true)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Updated) != 0 || len(res.Skipped) != 1 || res.Skipped[0].Reason != "older_version" {
		t.Fatalf("PUT at the lexically-larger older version = %+v", res)
	}
	if row := anchorReadRow(t, f, d, c.ID); row.AnchorVersionID.String != versions[1].ID || strings.Contains(string(row.Anchor), `"B1"`) {
		t.Fatalf("a skipped PUT moved the anchor: %+v", row)
	}
	// version 3 has the lexically SMALLEST id but the HIGHER ordinal: accepted.
	res2, err := anchorPut(t, f, member, d, versions[2].ID, c.ID, string(anchorRaw("xlsx", map[string]any{"range": "B9"})), "exact", true)
	if err != nil || len(res2.Updated) != 1 {
		t.Fatalf("PUT at the lexically-smaller newer version = %+v %v", res2, err)
	}
	if row := anchorReadRow(t, f, d, c.ID); row.AnchorVersionID.String != versions[2].ID {
		t.Fatalf("the newer version did not bind: %+v", row)
	}
}

// R1-5: a batch that changes two comments writes both rows, exactly one audit
// row and one outbox delta; a [valid, invalid] batch is a 400 that leaves both
// rows untouched.
func TestDocumentCommentAnchorsPutBatch(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "anchor-batch")
	d, versions := f.anchorDoc(t, tn, "xlsx", 3)
	member := Human(tn.member.ID)
	c1 := f.anchoredCreate(t, member, d, versions[0].ID, string(anchorRaw("xlsx", map[string]any{"range": "B7"})), "")
	c2 := f.anchoredCreate(t, member, d, versions[0].ID, string(anchorRaw("xlsx", map[string]any{"range": "C7"})), "")

	audits, outboxes := anchorAuditCount(t, f, d.ID), anchorOutboxCount(t, f, d.ID)
	res, err := f.svc.PutDocumentCommentAnchors(f.ctx, member, d.ID, DocumentCommentAnchorsInput{
		AnchorsPresent: true, VersionID: versions[2].ID,
		Anchors: []DocumentCommentAnchorItem{
			{CommentID: c1.ID, Anchor: anchorRaw("xlsx", map[string]any{"range": "B8"}), State: "exact"},
			{CommentID: c2.ID, Anchor: anchorRaw("xlsx", map[string]any{"range": "C8"}), State: "exact"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Updated) != 2 || len(res.Skipped) != 0 {
		t.Fatalf("two-comment batch = %+v", res)
	}
	for _, c := range []db.DocumentComment{c1, c2} {
		if row := anchorReadRow(t, f, d, c.ID); row.AnchorVersionID.String != versions[2].ID || row.AnchorState.String != "exact" {
			t.Fatalf("batch row = %+v", row)
		}
	}
	if n := anchorAuditCount(t, f, d.ID); n != audits+1 {
		t.Fatalf("two-comment batch audit rows = %d, want %d", n, audits+1)
	}
	if n := anchorOutboxCount(t, f, d.ID); n != outboxes+1 {
		t.Fatalf("two-comment batch outbox rows = %d, want %d", n, outboxes+1)
	}

	// [valid, invalid]: the whole call is a 400 and neither row moves.
	before1, before2 := anchorReadRow(t, f, d, c1.ID), anchorReadRow(t, f, d, c2.ID)
	_, err = f.svc.PutDocumentCommentAnchors(f.ctx, member, d.ID, DocumentCommentAnchorsInput{
		AnchorsPresent: true, VersionID: versions[2].ID,
		Anchors: []DocumentCommentAnchorItem{
			{CommentID: c1.ID, Anchor: anchorRaw("xlsx", map[string]any{"range": "D8"}), State: "exact"},
			{CommentID: c2.ID, Anchor: anchorRaw("xlsx", map[string]any{"color": "red"}), State: "exact"},
		},
	})
	if err == nil {
		t.Fatal("a mixed batch was accepted")
	} else if code, status, _ := anchorRefusal(t, err); code != "invalid_request" || status != 400 {
		t.Fatalf("mixed batch = %d %s", status, code)
	}
	after1, after2 := anchorReadRow(t, f, d, c1.ID), anchorReadRow(t, f, d, c2.ID)
	if !after1.UpdatedAt.Time.Equal(before1.UpdatedAt.Time) || !strings.Contains(string(after1.Anchor), `"B8"`) ||
		!after2.UpdatedAt.Time.Equal(before2.UpdatedAt.Time) || !strings.Contains(string(after2.Anchor), `"C8"`) {
		t.Fatalf("a refused mixed batch wrote: %+v %+v", after1, after2)
	}
}

// R1-11: a stored anchor_version_id whose row no longer exists counts as older
// than anything, so the next PUT is accepted and re-binds the anchor.
func TestDocumentCommentAnchorsPutStoredVersionDeleted(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "anchor-gone")
	d, versions := f.anchorDoc(t, tn, "xlsx", 3)
	member := Human(tn.member.ID)
	c := f.anchoredCreate(t, member, d, versions[1].ID, string(anchorRaw("xlsx", map[string]any{"range": "B7"})), "")
	// Drop the version the anchor points at; the branch must treat it as older.
	if _, err := f.pool.Exec(f.ctx, "DELETE FROM document_versions WHERE id = $1", versions[1].ID); err != nil {
		t.Fatal(err)
	}
	res, err := anchorPut(t, f, member, d, versions[2].ID, c.ID, string(anchorRaw("xlsx", map[string]any{"range": "B8"})), "exact", true)
	if err != nil || len(res.Updated) != 1 {
		t.Fatalf("PUT after the stored version vanished = %+v %v", res, err)
	}
	row := anchorReadRow(t, f, d, c.ID)
	if row.AnchorVersionID.String != versions[2].ID || !strings.Contains(string(row.Anchor), `"B8"`) {
		t.Fatalf("the anchor did not re-bind: %+v", row)
	}
}

// R1-12: the list_token a changing PUT returns equals the token the next list
// read returns, so a client that stores the PUT token is not told to reload.
func TestDocumentCommentAnchorsPutListTokenMatchesList(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "anchor-token")
	d, versions := f.anchorDoc(t, tn, "xlsx", 2)
	member := Human(tn.member.ID)
	c := f.anchoredCreate(t, member, d, versions[0].ID, string(anchorRaw("xlsx", nil)), "")
	res, err := anchorPut(t, f, member, d, versions[1].ID, c.ID, string(anchorRaw("xlsx", map[string]any{"range": "B8"})), "exact", true)
	if err != nil || len(res.Updated) != 1 {
		t.Fatalf("changing PUT = %+v %v", res, err)
	}
	list, err := f.svc.DocumentComments(f.ctx, member, d.ID, DocumentCommentListInput{})
	if err != nil {
		t.Fatal(err)
	}
	if list.Token != res.ListToken {
		t.Fatalf("PUT token %q != list token %q", res.ListToken, list.Token)
	}
	// The probe path agrees too: the token is stable, not merely present.
	probe, err := f.svc.DocumentComments(f.ctx, member, d.ID, DocumentCommentListInput{SinceToken: res.ListToken})
	if err != nil || !probe.Unchanged {
		t.Fatalf("probe with the PUT token = %+v %v, want unchanged", probe, err)
	}
}

// R1-13: the 500-item cap boundary. 500 items are accepted; 501 is a 400 that
// writes nothing.
func TestDocumentCommentAnchorsPutItemCap(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "anchor-cap")
	d, versions := f.anchorDoc(t, tn, "xlsx", 2)
	member := Human(tn.member.ID)
	c := f.anchoredCreate(t, member, d, versions[0].ID, string(anchorRaw("xlsx", nil)), "")

	// 500 copies of the same comment_id would be a duplicate, so the cap test
	// uses 500 distinct (foreign/unknown) ids: every one is skipped, the call
	// is accepted, and nothing is written.
	items := make([]DocumentCommentAnchorItem, 0, maxDocumentCommentAnchorItems)
	for i := 0; i < maxDocumentCommentAnchorItems; i++ {
		items = append(items, DocumentCommentAnchorItem{CommentID: util.NewID(), Anchor: anchorRaw("xlsx", nil), State: "exact"})
	}
	res, err := f.svc.PutDocumentCommentAnchors(f.ctx, member, d.ID, DocumentCommentAnchorsInput{
		AnchorsPresent: true, VersionID: versions[1].ID, Anchors: items,
	})
	if err != nil || len(res.Skipped) != maxDocumentCommentAnchorItems {
		t.Fatalf("500-item PUT = %+v %v", res, err)
	}
	// One over the cap: 400, nothing written.
	items = append(items, DocumentCommentAnchorItem{CommentID: c.ID, Anchor: anchorRaw("xlsx", nil), State: "exact"})
	before := anchorReadRow(t, f, d, c.ID)
	if _, err := f.svc.PutDocumentCommentAnchors(f.ctx, member, d.ID, DocumentCommentAnchorsInput{
		AnchorsPresent: true, VersionID: versions[1].ID, Anchors: items,
	}); err == nil {
		t.Fatal("501 items accepted")
	} else if code, status, _ := anchorRefusal(t, err); code != "invalid_request" || status != 400 {
		t.Fatalf("501 items = %d %s", status, code)
	}
	if after := anchorReadRow(t, f, d, c.ID); !after.UpdatedAt.Time.Equal(before.UpdatedAt.Time) {
		t.Fatal("the over-cap PUT wrote a row")
	}
}
