package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/document"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Pages (C-01 §5.1; G1-04a, UNI-678): create, get and PATCH of the working
// copy. Content is sanitized before any transaction opens; the base revision
// is checked under the document row lock (withDocumentMutation), after the
// per-field permission check, so a reader with a stale tab learns "forbidden"
// and never the current revision.

const (
	documentVisibilityWorkspace = "workspace"
	// maxDocumentDepth is the tree bound (C-01 §3.1): a root page is depth 1.
	maxDocumentDepth   = 5
	maxDocumentTitle   = 500
	maxDocumentIconLen = 8
)

// DocumentCrumb is one ancestor on the way to a document, root first.
type DocumentCrumb struct {
	ID    string
	Title string
	Icon  string
}

// DocumentView is what the page commands answer (DocumentSDO): the row, the
// caller's level and path, the ancestors the caller may read and, for a file
// document, its current version (set by GetDocument and the file restore).
type DocumentView struct {
	Document    db.Document
	Access      DocumentAccess
	Breadcrumbs []DocumentCrumb
	File        *DocumentFileInfo
}

// CreatePageInput is POST /workspaces/{ws}/documents with kind page.
// Visibility empty means the parent's (children inherit it at create time,
// C-01 §4), or workspace at the root. A non-empty IdempotencyKey binds the
// create to its payload fingerprint (DOC-005 §3.1): a retry replays the page,
// another payload under the same key is idempotency_payload_mismatch.
type CreatePageInput struct {
	ParentID       string
	Title          string
	Icon           string
	Visibility     string
	Content        json.RawMessage
	IdempotencyKey string
}

// UpdateDocumentInput is PATCH /documents/{id}. Revision is the base the
// client edited; nil fields are left as they are, an empty Icon clears it,
// nil Content keeps the working copy.
type UpdateDocumentInput struct {
	Revision   int64
	Title      *string
	Icon       *string
	Visibility *string
	Content    json.RawMessage
}

// errRevisionConflict is the page-conflict answer of the contract samples
// (error-conflict.json): 422, class conflict, current revision as a decimal
// string.
func errRevisionConflict(current int64) error {
	return CodedError{
		Code:   "revision_conflict",
		Status: http.StatusUnprocessableEntity,
		Msg:    "tài liệu đã thay đổi kể từ lần bạn mở nó",
		Err:    ErrConflict,
		Fields: map[string]any{"current_revision": strconv.FormatInt(current, 10)},
	}
}

func errDocumentTooDeep() error {
	return coded(http.StatusUnprocessableEntity, "document_too_deep", "cây tài liệu sâu tối đa 5 cấp")
}

func cleanDocumentTitle(title string) (string, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return "", Invalid("tên tài liệu không được để trống")
	}
	if len([]rune(title)) > maxDocumentTitle {
		return "", Invalid("tên tài liệu tối đa 500 ký tự")
	}
	return title, nil
}

func cleanDocumentIcon(icon string) (pgtype.Text, error) {
	icon = strings.TrimSpace(icon)
	if len([]rune(icon)) > maxDocumentIconLen {
		return pgtype.Text{}, Invalid("biểu tượng tối đa 8 ký tự")
	}
	return pgtype.Text{String: icon, Valid: icon != ""}, nil
}

func validDocumentVisibility(v string) error {
	if v != documentVisibilityWorkspace && v != documentVisibilityRestricted {
		return Invalid("visibility phải là workspace hoặc restricted")
	}
	return nil
}

// sanitizedPage is page JSON after the closed schema ran over it.
type sanitizedPage struct {
	content []byte
	text    string
}

func sanitizePage(raw json.RawMessage) (sanitizedPage, error) {
	content, text, err := document.Sanitize(raw)
	if err != nil {
		return sanitizedPage{}, documentServiceError(err)
	}
	return sanitizedPage{content: content, text: text}, nil
}

// CreatePage creates a page in a workspace the caller belongs to, at the root
// or under a page they may edit. Agents never write documents directly
// (ADR 0010).
func (s *DocumentService) CreatePage(ctx context.Context, actor Actor, workspaceID string, in CreatePageInput) (DocumentView, error) {
	if actor.Kind != audit.KindHuman || !validActor(actor) {
		return DocumentView{}, ErrForbidden
	}
	title, err := cleanDocumentTitle(in.Title)
	if err != nil {
		return DocumentView{}, err
	}
	icon, err := cleanDocumentIcon(in.Icon)
	if err != nil {
		return DocumentView{}, err
	}
	if in.Visibility != "" {
		if err := validDocumentVisibility(in.Visibility); err != nil {
			return DocumentView{}, err
		}
	}
	var page sanitizedPage
	if len(in.Content) > 0 {
		if page, err = sanitizePage(in.Content); err != nil {
			return DocumentView{}, err
		}
	}
	if _, err := s.ws.RequireMember(ctx, workspaceID, actor.ID); err != nil {
		return DocumentView{}, err
	}
	w, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DocumentView{}, ErrNotFound
	}
	if err != nil {
		return DocumentView{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DocumentView{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	// Membership again, through the transaction: a removal that committed
	// since the first check wins.
	if _, err := s.ws.RequireMemberQ(ctx, q, workspaceID, actor.ID); err != nil {
		return DocumentView{}, err
	}
	sum := sha256.Sum256(page.content)
	opts := IdempotencyOptions{
		Fingerprint: IdempotencyFingerprint(idempotencyScopeDocumentPageCreate, workspaceID, in.ParentID,
			title, icon.String, in.Visibility, hex.EncodeToString(sum[:])),
		RequireFingerprint: true,
	}
	replay, commit, err := BeginIdempotent(ctx, q, w.OrganizationID, workspaceID, idempotencyScopeDocumentPageCreate, in.IdempotencyKey, actor.ID, opts)
	if err != nil {
		return DocumentView{}, NormalizeIdempotencyError(err)
	}
	if replay != nil {
		return s.replayCreatedPage(ctx, q, actor, w.OrganizationID, workspaceID, replay.Body)
	}
	// Order: idempotency claim, then the tree lock, then document row locks.
	// Two creates under the same parent (or at the root, where no parent row
	// serializes them) never share a position.
	if err := q.LockDocumentTree(ctx, workspaceID); err != nil {
		return DocumentView{}, err
	}
	visibility := in.Visibility
	if in.ParentID != "" {
		parent, err := s.lockPageParent(ctx, q, actor, in.ParentID, w.OrganizationID, workspaceID)
		if err != nil {
			return DocumentView{}, err
		}
		if visibility == "" {
			visibility = parent.Visibility
		}
	}
	if visibility == "" {
		visibility = documentVisibilityWorkspace
	}
	position, err := q.NextDocumentPosition(ctx, db.NextDocumentPositionParams{
		OrganizationID: w.OrganizationID, WorkspaceID: workspaceID, ParentID: nullText(in.ParentID),
	})
	if err != nil {
		return DocumentView{}, err
	}
	docID := util.NewID()
	if err := s.consumePageBytes(ctx, q, actor, db.Document{ID: docID, OrganizationID: w.OrganizationID, WorkspaceID: workspaceID}, int64(len(page.content))); err != nil {
		return DocumentView{}, err
	}
	doc, err := q.InsertDocument(ctx, db.InsertDocumentParams{
		ID:             docID,
		OrganizationID: w.OrganizationID,
		WorkspaceID:    workspaceID,
		ParentID:       nullText(in.ParentID),
		Kind:           DocumentKindPage,
		Title:          title,
		Icon:           icon,
		Visibility:     visibility,
		Content:        page.content,
		ContentText:    page.text,
		SearchText:     documentSearchText(title, page.text),
		ContentBytes:   int32(len(page.content)),
		Revision:       1,
		Position:       position,
		AclOwnerID:     aclOwnerFor(actor),
		CreatedBy:      actor.ID,
		CreatedByKind:  string(actor.Kind),
		UpdatedBy:      actor.ID,
		UpdatedByKind:  string(actor.Kind),
	})
	if err != nil {
		return DocumentView{}, err
	}
	created := map[string]any{"title": doc.Title, "kind": doc.Kind, "visibility": doc.Visibility}
	if in.ParentID != "" {
		created["parent_id"] = in.ParentID
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		Actor:          actor,
		Action:         audit.ActionDocumentCreated,
		ResourceType:   "document",
		ResourceID:     doc.ID,
		Changes:        audit.Diff(nil, created),
	}, audit.Event{Topic: "document.created", Payload: map[string]string{
		"document_id": doc.ID, "workspace_id": doc.WorkspaceID,
	}}); err != nil {
		return DocumentView{}, err
	}
	view, err := s.documentView(ctx, q, actor, doc)
	if err != nil {
		return DocumentView{}, err
	}
	body, err := json.Marshal(pageReplay{DocumentID: doc.ID})
	if err != nil {
		return DocumentView{}, err
	}
	if err := commit(http.StatusCreated, body); err != nil {
		return DocumentView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DocumentView{}, err
	}
	return view, nil
}

// pageReplay is what the ledger keeps for a page create: the id only.
type pageReplay struct {
	DocumentID string `json:"document_id"`
}

// replayCreatedPage answers a replayed create with the page as it is now and
// the caller's current level: a caller who can no longer read it (or a page
// gone since) gets not found, never a stored snapshot.
func (s *DocumentService) replayCreatedPage(ctx context.Context, q *db.Queries, actor Actor, orgID, workspaceID string, body []byte) (DocumentView, error) {
	var r pageReplay
	if err := json.Unmarshal(body, &r); err != nil {
		return DocumentView{}, err
	}
	doc, err := q.GetDocument(ctx, db.GetDocumentParams{ID: r.DocumentID, OrganizationID: orgID, WorkspaceID: workspaceID})
	if errors.Is(err, pgx.ErrNoRows) {
		return DocumentView{}, ErrNotFound
	}
	if err != nil {
		return DocumentView{}, err
	}
	view, err := s.documentView(ctx, q, actor, doc)
	if err != nil {
		return DocumentView{}, err
	}
	if decideDocumentAccess(doc, view.Access, DocumentLevelView) != nil {
		return DocumentView{}, ErrNotFound
	}
	return view, nil
}

// lockPageParent locks the parent row for the rest of the create (an archive
// or move of the parent waits for it) and checks it: a live page of the same
// tenant pair, outside any work product, that the caller may edit, with room
// for one more level below it.
func (s *DocumentService) lockPageParent(ctx context.Context, q *db.Queries, actor Actor, parentID, orgID, workspaceID string) (db.Document, error) {
	parent, err := q.LockDocumentByID(ctx, parentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Document{}, ErrNotFound
	}
	if err != nil {
		return db.Document{}, err
	}
	if parent.OrganizationID != orgID || parent.WorkspaceID != workspaceID || parent.OwnerKind.Valid {
		return db.Document{}, ErrNotFound
	}
	access, err := s.effectiveLevel(ctx, q, actor, parent)
	if err != nil {
		return db.Document{}, err
	}
	if err := decideDocumentAccess(parent, access, DocumentLevelEdit); err != nil {
		return db.Document{}, err
	}
	// The trash is not a place to create in, whoever may restore it.
	if parent.ArchivedAt.Valid {
		return db.Document{}, ErrNotFound
	}
	if parent.Kind != DocumentKindPage {
		return db.Document{}, Invalid("chỉ trang mới chứa được trang con")
	}
	depth, err := documentDepth(ctx, q, parent)
	if err != nil {
		return db.Document{}, err
	}
	if depth+1 > maxDocumentDepth {
		return db.Document{}, errDocumentTooDeep()
	}
	return parent, nil
}

// documentDepth counts d and its ancestors (a root page is 1). A chain that
// does not end within twice the bound is reported as too deep rather than
// walked forever.
func documentDepth(ctx context.Context, q *db.Queries, d db.Document) (int, error) {
	depth := 1
	for d.ParentID.Valid {
		if depth > 2*maxDocumentDepth {
			return 0, errDocumentTooDeep()
		}
		p, err := q.GetDocument(ctx, db.GetDocumentParams{
			ID: d.ParentID.String, OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			break
		}
		if err != nil {
			return 0, err
		}
		d = p
		depth++
	}
	return depth, nil
}

// GetDocument opens one document for a reader and logs the view
// (C-01 §5.1). Anyone below view gets not found.
func (s *DocumentService) GetDocument(ctx context.Context, actor Actor, documentID string) (DocumentView, error) {
	doc, access, err := s.authorizeDocument(ctx, actor, documentID, DocumentLevelView)
	if err != nil {
		return DocumentView{}, err
	}
	crumbs, err := s.documentBreadcrumbs(ctx, s.q, actor, doc)
	if err != nil {
		return DocumentView{}, err
	}
	file, err := s.currentFileInfo(ctx, doc)
	if err != nil {
		return DocumentView{}, err
	}
	s.RecordDocumentRead(ctx, actor, doc, access, DocumentAccessView, nil)
	return DocumentView{Document: doc, Access: access, Breadcrumbs: crumbs, File: file}, nil
}

// currentFileInfo is the `file` block of a file document: its current
// version's snapshot and the stored filename. Outside any transaction on
// purpose - FileService reads through its own connection. A filename
// FileService cannot resolve (being deleted, not ready) falls back to the
// title rather than failing the whole read.
func (s *DocumentService) currentFileInfo(ctx context.Context, doc db.Document) (*DocumentFileInfo, error) {
	if doc.Kind != DocumentKindFile {
		return nil, nil
	}
	v, err := s.currentFileVersion(ctx, s.q, doc)
	if err != nil || v == nil {
		return nil, err
	}
	name := doc.Title
	if s.files != nil && v.FileID.Valid {
		resolved, err := s.files.ResolveMany(ctx, files.ResolveInput{
			Scope: documentScope(doc.OrganizationID, doc.WorkspaceID), Mode: files.ReadProxy,
			Disposition: files.DispositionAttachment, FileIDs: []files.FileID{files.FileID(v.FileID.String)},
		})
		if err == nil && len(resolved) == 1 && resolved[0].Err == nil && resolved[0].File.Filename != "" {
			name = resolved[0].File.Filename
		}
	}
	info := fileInfoOf(*v, name)
	return &info, nil
}

// documentView re-derives the caller's access on doc through q and adds the
// breadcrumbs, for commands answering with the row they just wrote.
func (s *DocumentService) documentView(ctx context.Context, q *db.Queries, actor Actor, doc db.Document) (DocumentView, error) {
	access, err := s.effectiveLevel(ctx, q, actor, doc)
	if err != nil {
		return DocumentView{}, err
	}
	crumbs, err := s.documentBreadcrumbs(ctx, q, actor, doc)
	if err != nil {
		return DocumentView{}, err
	}
	return DocumentView{Document: doc, Access: access, Breadcrumbs: crumbs}, nil
}

// documentBreadcrumbs walks up from doc's parent and stops at the first
// ancestor the caller cannot read: no title above an unreadable page leaks,
// not even of a readable page further up. Root first.
func (s *DocumentService) documentBreadcrumbs(ctx context.Context, q *db.Queries, actor Actor, doc db.Document) ([]DocumentCrumb, error) {
	var up []DocumentCrumb
	cur := doc
	for cur.ParentID.Valid && len(up) < 2*maxDocumentDepth {
		p, err := q.GetDocument(ctx, db.GetDocumentParams{
			ID: cur.ParentID.String, OrganizationID: cur.OrganizationID, WorkspaceID: cur.WorkspaceID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			break
		}
		if err != nil {
			return nil, err
		}
		access, err := s.resolveLevel(ctx, q, actor, p)
		if err != nil {
			if isGateRefusal(err) {
				break
			}
			return nil, err
		}
		if decideDocumentAccess(p, access, DocumentLevelView) != nil {
			break
		}
		up = append(up, DocumentCrumb{ID: p.ID, Title: p.Title, Icon: p.Icon.String})
		cur = p
	}
	crumbs := make([]DocumentCrumb, len(up))
	for i, c := range up {
		crumbs[len(up)-1-i] = c
	}
	return crumbs, nil
}

// UpdateDocument applies a PATCH to the working copy. Levels per field:
// title, icon and content need edit; visibility needs manage and is refused
// on a document a work product owns (§13.4). A patch that changes nothing
// writes nothing and keeps the revision.
//
// Audit is metadata only - the changed metadata fields, the new revision and
// whether (not what) the content changed - never the page JSON. The
// document.updated frame goes out only when title, icon or visibility moved
// (C-01 §5.1/§6.1): an autosave does not fan out to the workspace, and no
// frame carries a revision (ADR 0015 opens that to task.updated only).
func (s *DocumentService) UpdateDocument(ctx context.Context, actor Actor, documentID string, in UpdateDocumentInput) (DocumentView, error) {
	if in.Title == nil && in.Icon == nil && in.Visibility == nil && in.Content == nil {
		return DocumentView{}, Invalid("không có trường nào để cập nhật")
	}
	var title string
	var icon pgtype.Text
	var err error
	if in.Title != nil {
		if title, err = cleanDocumentTitle(*in.Title); err != nil {
			return DocumentView{}, err
		}
	}
	if in.Icon != nil {
		if icon, err = cleanDocumentIcon(*in.Icon); err != nil {
			return DocumentView{}, err
		}
	}
	if in.Visibility != nil {
		if err := validDocumentVisibility(*in.Visibility); err != nil {
			return DocumentView{}, err
		}
	}
	var page sanitizedPage
	if in.Content != nil {
		if page, err = sanitizePage(in.Content); err != nil {
			return DocumentView{}, err
		}
	}

	var out DocumentView
	err = s.withDocumentMutation(ctx, actor, documentID, DocumentLevelView, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		if in.Title != nil || in.Icon != nil || in.Content != nil {
			if !access.Level.AtLeast(DocumentLevelEdit) {
				return ErrForbidden
			}
		}
		if in.Visibility != nil {
			if doc.OwnerKind.Valid {
				return errDocumentOwned()
			}
			if !access.Level.AtLeast(DocumentLevelManage) {
				return ErrForbidden
			}
		}
		if doc.ArchivedAt.Valid {
			// The trash is read-only; the same answer as version and restore.
			return errDocumentDeleted()
		}
		if in.Content != nil && doc.Kind != DocumentKindPage {
			return Invalid("tài liệu file không nhận content")
		}
		if in.Revision != doc.Revision {
			return errRevisionConflict(doc.Revision)
		}

		next := db.UpdateDocumentFieldsParams{
			Title: doc.Title, Icon: doc.Icon, Visibility: doc.Visibility,
			Content: doc.Content, ContentText: doc.ContentText, ContentBytes: doc.ContentBytes,
		}
		before, after := map[string]any{}, map[string]any{}
		if in.Title != nil && title != doc.Title {
			before["title"], after["title"] = doc.Title, title
			next.Title = title
		}
		if in.Icon != nil && icon != doc.Icon {
			before["icon"], after["icon"] = textOrNil(doc.Icon), textOrNil(icon)
			next.Icon = icon
		}
		if in.Visibility != nil && *in.Visibility != doc.Visibility {
			before["visibility"], after["visibility"] = doc.Visibility, *in.Visibility
			next.Visibility = *in.Visibility
		}
		contentChanged := in.Content != nil && !sameJSON(page.content, doc.Content)
		if contentChanged {
			next.Content, next.ContentText, next.ContentBytes = page.content, page.text, int32(len(page.content))
		}
		metaChanged := len(after) > 0
		if !metaChanged && !contentChanged {
			view, err := s.documentView(ctx, q, actor, doc)
			out = view
			return err
		}
		next.SearchText = documentSearchText(next.Title, next.ContentText)
		next.UpdatedBy, next.UpdatedByKind = actor.ID, string(actor.Kind)
		next.ContentChanged = contentChanged
		next.ID, next.OrganizationID, next.WorkspaceID = doc.ID, doc.OrganizationID, doc.WorkspaceID
		next.ExpectedRevision = doc.Revision
		if contentChanged {
			if err := s.consumePageBytes(ctx, q, actor, doc, int64(next.ContentBytes)-int64(doc.ContentBytes)); err != nil {
				return err
			}
		}
		updated, err := q.UpdateDocumentFields(ctx, next)
		if errors.Is(err, pgx.ErrNoRows) {
			return errRevisionConflict(doc.Revision)
		}
		if err != nil {
			return err
		}
		if contentChanged {
			if err := syncDocumentAssetRefs(ctx, q, updated); err != nil {
				return err
			}
		}
		var emit []audit.Event
		if metaChanged {
			emit = append(emit, audit.Event{Topic: "document.updated", Payload: map[string]string{
				"document_id": updated.ID, "workspace_id": updated.WorkspaceID,
			}})
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: updated.OrganizationID,
			WorkspaceID:    updated.WorkspaceID,
			Actor:          actor,
			Action:         audit.ActionDocumentUpdated,
			ResourceType:   "document",
			ResourceID:     updated.ID,
			Changes:        audit.Diff(before, after),
			Metadata: map[string]any{
				"revision":        strconv.FormatInt(updated.Revision, 10),
				"content_changed": contentChanged,
				"content_bytes":   updated.ContentBytes,
			},
		}, emit...); err != nil {
			return err
		}
		view, err := s.documentView(ctx, q, actor, updated)
		out = view
		return err
	})
	if err != nil {
		return DocumentView{}, err
	}
	// The file block is read after the commit: FileService uses its own
	// connection, never one borrowed under the document lock.
	if out.File, err = s.currentFileInfo(ctx, out.Document); err != nil {
		return DocumentView{}, err
	}
	return out, nil
}

func textOrNil(t pgtype.Text) any {
	if !t.Valid {
		return nil
	}
	return t.String
}

// sameJSON compares two JSON values by meaning: jsonb hands back its own
// spacing and key order, so the stored bytes never equal the sanitizer's.
func sameJSON(a, b []byte) bool {
	if len(a) == 0 || len(b) == 0 {
		return len(a) == len(b)
	}
	ca, errA := canonicalJSON(a)
	cb, errB := canonicalJSON(b)
	return errA == nil && errB == nil && bytes.Equal(ca, cb)
}

func canonicalJSON(raw []byte) ([]byte, error) {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	return json.Marshal(v) // maps marshal with sorted keys
}

// syncDocumentAssetRefs keeps document_assets.orphaned_at in step with the
// working copy (C-01 §3.3/§14.2): an asset the content stopped referencing
// is stamped now, one it references again loses its stamp. Called in the
// transaction that wrote the content, so the reference provider never sees
// a half-applied save.
func syncDocumentAssetRefs(ctx context.Context, q *db.Queries, doc db.Document) error {
	assets, err := q.ListDocumentAssetsByDocument(ctx, db.ListDocumentAssetsByDocumentParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
	})
	if err != nil || len(assets) == 0 {
		return err
	}
	refs := documentAssetRefs(doc.Content)
	var back []string
	for _, a := range assets {
		switch {
		case refs[a.ID] && a.OrphanedAt.Valid:
			back = append(back, a.ID)
		case !refs[a.ID] && !a.OrphanedAt.Valid:
			if err := q.MarkDocumentAssetOrphaned(ctx, db.MarkDocumentAssetOrphanedParams{
				ID: a.ID, OrganizationID: a.OrganizationID, WorkspaceID: a.WorkspaceID, DocumentID: a.DocumentID,
			}); err != nil {
				return err
			}
		}
	}
	if len(back) == 0 {
		return nil
	}
	return q.ClearDocumentAssetsOrphaned(ctx, db.ClearDocumentAssetsOrphanedParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID, Ids: back,
	})
}

// documentAssetRefs collects the asset ids a sanitized page references
// through image src = asset://{id} (the only place the schema admits one).
func documentAssetRefs(content []byte) map[string]bool {
	refs := map[string]bool{}
	if len(content) == 0 {
		return refs
	}
	var root any
	if err := json.Unmarshal(content, &root); err != nil {
		return refs
	}
	var walk func(v any)
	walk = func(v any) {
		switch n := v.(type) {
		case map[string]any:
			if n["type"] == "image" {
				if attrs, ok := n["attrs"].(map[string]any); ok {
					if src, ok := attrs["src"].(string); ok && strings.HasPrefix(src, "asset://") {
						refs[strings.TrimPrefix(src, "asset://")] = true
					}
				}
			}
			if children, ok := n["content"].([]any); ok {
				for _, c := range children {
					walk(c)
				}
			}
		case []any:
			for _, c := range n {
				walk(c)
			}
		}
	}
	walk(root)
	return refs
}
