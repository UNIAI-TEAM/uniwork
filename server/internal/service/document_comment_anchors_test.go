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
	rootNoAnchor, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "gốc", CommentType: "comment"}, "")
	if err != nil {
		t.Fatal(err)
	}
	badBodies := []AddCommentInput{
		{Body: "trả lời", CommentType: "comment", ParentID: &rootNoAnchor.ID, Anchor: anchorRaw("xlsx", nil), BaseVersionID: versions[2].ID},
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
			VersionID: versionID,
			Anchors:   []DocumentCommentAnchorItem{{CommentID: comment.ID, Anchor: json.RawMessage(anchor), State: state}},
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
			VersionID: versionID, Anchors: []DocumentCommentAnchorItem{{CommentID: comment.ID, Anchor: anchorRaw("xlsx", nil), State: "exact"}},
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
		VersionID: versions[2].ID,
		Anchors:   []DocumentCommentAnchorItem{{CommentID: otherComment.ID, Anchor: anchorRaw("xlsx", map[string]any{"range": "B8"}), State: "exact"}},
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
		VersionID: versions[2].ID,
		Anchors:   []DocumentCommentAnchorItem{{CommentID: discussion.ID, Anchor: anchorRaw("xlsx", nil), State: "exact"}},
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
			VersionID: versions[2].ID, Anchors: []DocumentCommentAnchorItem{item},
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
