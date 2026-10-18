package handler

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Documents collections HTTP (C-01 §5.1; UNI-679, G1-05b): the list/search,
// recent, shared-with-me and tree reads plus move/archive/restore. The
// handlers stay thin - parse the wire, build the human actor, hand the scope
// to DocumentService and map its errors; they never query the database and
// never widen a service input with a client-supplied field.

// documentListInput parses the query shared by the list and recent routes.
// parent_id PRESENCE is the switch between "one tree level" (set, possibly
// empty = roots) and the flat workspace list (absent); the service owns the
// filter, permission and cursor semantics.
func documentListInput(w http.ResponseWriter, r *http.Request) (service.ListDocumentsInput, bool) {
	q := r.URL.Query()
	in := service.ListDocumentsInput{
		Query:      strings.TrimSpace(q.Get("q")),
		Match:      strings.TrimSpace(q.Get("match")),
		Kind:       strings.TrimSpace(q.Get("kind")),
		Format:     strings.TrimSpace(q.Get("format")),
		Access:     strings.TrimSpace(q.Get("access")),
		UpdatedBy:  strings.TrimSpace(q.Get("updated_by")),
		SharedByMe: strings.TrimSpace(q.Get("shared_by_me")) == "true",
		Cursor:     strings.TrimSpace(q.Get("cursor")),
	}
	if q.Has("parent_id") {
		parent := strings.TrimSpace(q.Get("parent_id"))
		in.ParentID = &parent
	}
	if raw := strings.TrimSpace(q.Get("archived")); raw != "" {
		v, err := strconv.ParseBool(raw)
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid_request", "archived must be 0/1 or true/false")
			return in, false
		}
		in.Archived = v
	}
	if raw := strings.TrimSpace(q.Get("shelved")); raw != "" {
		v, err := strconv.ParseBool(raw)
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid_request", "shelved must be 0/1 or true/false")
			return in, false
		}
		in.Shelved = v
	}
	for _, f := range []struct {
		name string
		dst  *time.Time
	}{{"updated_from", &in.UpdatedFrom}, {"updated_to", &in.UpdatedTo}} {
		raw := strings.TrimSpace(q.Get(f.name))
		if raw == "" {
			continue
		}
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid_request", f.name+" must be an RFC3339 timestamp")
			return in, false
		}
		*f.dst = t
	}
	if raw := strings.TrimSpace(q.Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			respondError(w, http.StatusBadRequest, "invalid_request", "limit must be a non-negative integer")
			return in, false
		}
		in.Limit = n
	}
	return in, true
}

// listDocuments is GET /workspaces/{workspaceID}/documents: the flat list,
// one tree level (parent_id) or a workspace search (q). Permission filtering
// happens inside the query, so a page never counts rows the actor cannot see.
func (h *handlers) listDocuments(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	in, ok := documentListInput(w, r)
	if !ok {
		return
	}
	page, err := h.Documents.ListDocuments(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"), in)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, documentListSDO(page))
}

// listRecentDocuments is GET /workspaces/{workspaceID}/documents/recent: what
// the person opened (access log) or last edited. Agents have no "recent" and
// the service refuses them.
func (h *handlers) listRecentDocuments(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	in, ok := documentListInput(w, r)
	if !ok {
		return
	}
	page, err := h.Documents.ListRecentDocuments(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"), in)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, documentListSDO(page))
}

// listSharedWithMe is GET /workspaces/{workspaceID}/documents/shared-with-me.
// The workspace in the URL names the context the caller is in (RequireMember
// applies); the list itself spans the organization's workspaces, because a
// share reaches the recipient without joining the source workspace. The
// service walks candidates by keyset and filters before filling the page, so
// a denied candidate never consumes a result slot; `limit`/`cursor` page it.
func (h *handlers) listSharedWithMe(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	userID := middleware.UserID(r.Context())
	view, err := h.Workspaces.GetView(r.Context(), userID, chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	in := service.SharedWithMeQuery{
		Format: strings.TrimSpace(r.URL.Query().Get("format")),
		Access: strings.TrimSpace(r.URL.Query().Get("access")),
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("cursor")); raw != "" {
		at, id, ok := decodeSharedWithMeCursor(raw)
		if !ok {
			respondError(w, http.StatusBadRequest, "invalid_request", "cursor không hợp lệ")
			return
		}
		in.AfterCreatedAt, in.AfterID = at, id
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			respondError(w, http.StatusBadRequest, "invalid_request", "limit must be a non-negative integer")
			return
		}
		in.Limit = n
	}
	page, err := h.Documents.ListSharedWithMe(r.Context(), userID, view.OrganizationID, in)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.DocumentListSDO{Documents: make([]sdo.DocumentSummaryDTO, 0, len(page.Items))}
	for _, row := range page.Items {
		out.Documents = append(out.Documents, toSharedDocumentSummaryDTO(row))
	}
	if page.NextID != "" {
		cursor := encodeSharedWithMeCursor(page.NextCreatedAt, page.NextID)
		out.NextCursor = &cursor
	}
	respondJSON(w, http.StatusOK, out)
}

// getDocumentTree is GET /workspaces/{workspaceID}/documents/tree?root=: the
// sidebar forest to the depth bound, metadata only. An unreadable root is not
// found; its children are not leaked through it. folders_only serves the
// FOLDERS sidebar: the same nodes cut to kind=folder.
func (h *handlers) getDocumentTree(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	q := r.URL.Query()
	root := strings.TrimSpace(q.Get("root"))
	foldersOnly := false
	if raw := strings.TrimSpace(q.Get("folders_only")); raw != "" {
		v, err := strconv.ParseBool(raw)
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid_request", "folders_only must be 0/1 or true/false")
			return
		}
		foldersOnly = v
	}
	nodes, err := h.Documents.DocumentTree(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"), root, foldersOnly)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DocumentTreeSDO{Documents: documentTreeDTOs(nodes)})
}

// moveDocument is POST /documents/{documentID}/move: reparent/reorder inside
// one workspace. A stale revision, a cycle, a depth past the bound or a
// foreign parent is refused by the service; Idempotency-Key replays a retry.
func (h *handlers) moveDocument(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.MoveDocumentSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	revision, err := strconv.ParseInt(strings.TrimSpace(in.Revision), 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "revision must be a decimal string")
		return
	}
	view, err := h.Documents.MoveDocument(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"), service.MoveDocumentInput{
		ParentID:       stringValue(in.ParentID),
		Position:       in.Position,
		Revision:       revision,
		IdempotencyKey: r.Header.Get("Idempotency-Key"),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DocumentSDO{Document: documentDTO(view)})
}

// archiveDocument is POST /documents/{documentID}/archive: the subtree moves
// to the trash in one transaction after the manage check on every node.
func (h *handlers) archiveDocument(w http.ResponseWriter, r *http.Request) {
	h.documentLifecycleCommand(w, r, false)
}

// archiveImpact is GET /documents/{documentID}/archive-impact: what the
// archive command would move, without moving it (FD-04, addendum §3.4). The
// service answers the same refusals the command would, so the dialog never
// shows numbers for a delete that cannot happen.
func (h *handlers) archiveImpact(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	impact, err := h.Documents.ArchiveImpact(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, documentArchiveImpactSDO(impact))
}

// restoreDocument is POST /documents/{documentID}/restore: only the nodes a
// single archive batch moved come back; Idempotency-Key replays a retry.
func (h *handlers) restoreDocument(w http.ResponseWriter, r *http.Request) {
	h.documentLifecycleCommand(w, r, true)
}

// purgeDocument is POST /documents/{documentID}/purge: permanently deletes an
// archived document and its same-batch, still-trashed descendants that the
// caller manages (RESTORE-01 §2).
func (h *handlers) purgeDocument(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	if _, err := h.Documents.PurgeDocument(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// shelveDocument is POST /documents/{documentID}/shelve (ARCHIVE-01): the
// live, not-yet-shelved subtree moves to the read-only shelf in one
// transaction after the manage check on every node - the trash command's own
// gate, so below manage on an invisible row the answer is 404/403 alike.
func (h *handlers) shelveDocument(w http.ResponseWriter, r *http.Request) {
	h.documentShelveCommand(w, r, false)
}

// unshelveDocument is POST /documents/{documentID}/unshelve (ARCHIVE-01):
// the item and its same-batch shelved descendants the caller manages come
// back; position in the tree never moved.
func (h *handlers) unshelveDocument(w http.ResponseWriter, r *http.Request) {
	h.documentShelveCommand(w, r, true)
}

func (h *handlers) documentShelveCommand(w http.ResponseWriter, r *http.Request, unshelve bool) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	actor := service.Human(middleware.UserID(r.Context()))
	documentID := chi.URLParam(r, "documentID")
	in := service.ArchiveDocumentInput{IdempotencyKey: r.Header.Get("Idempotency-Key")}
	var (
		res service.DocumentArchiveResult
		err error
	)
	if unshelve {
		res, err = h.Documents.UnshelveDocument(r.Context(), actor, documentID, in)
	} else {
		res, err = h.Documents.ShelveDocument(r.Context(), actor, documentID, in)
	}
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, documentArchiveSDO(res))
}

func (h *handlers) documentLifecycleCommand(w http.ResponseWriter, r *http.Request, restore bool) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	actor := service.Human(middleware.UserID(r.Context()))
	documentID := chi.URLParam(r, "documentID")
	in := service.ArchiveDocumentInput{IdempotencyKey: r.Header.Get("Idempotency-Key")}
	var (
		res service.DocumentArchiveResult
		err error
	)
	if restore {
		res, err = h.Documents.RestoreDocument(r.Context(), actor, documentID, in)
	} else {
		res, err = h.Documents.ArchiveDocument(r.Context(), actor, documentID, in)
	}
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, documentArchiveSDO(res))
}

// documentListSDO renders one page of the shared list shape.
func documentListSDO(page service.DocumentListPage) sdo.DocumentListSDO {
	out := sdo.DocumentListSDO{Documents: make([]sdo.DocumentSummaryDTO, 0, len(page.Items))}
	for _, item := range page.Items {
		out.Documents = append(out.Documents, toDocumentSummaryDTO(item))
	}
	if page.NextCursor != "" {
		out.NextCursor = &page.NextCursor
	}
	return out
}

func toDocumentSummaryDTO(item service.DocumentListItem) sdo.DocumentSummaryDTO {
	var access *service.DocumentAccess
	// A locked row (AdminScope, no read level) still carries admin_scope.
	if item.Access.Level != service.DocumentLevelNone || item.Access.AdminScope {
		access = &item.Access
	}
	dto := documentSummaryDTO(item.Document, item.Facts, item.Snippet, access)
	dto.EditLock = documentRowEditLockSDO(item.EditLock)
	dto.ShareScope = documentRowShareScopeSDO(item.ShareScope)
	if len(item.Path) > 0 {
		dto.Path = make([]sdo.DocumentPathItemSDO, len(item.Path))
		for i, p := range item.Path {
			dto.Path[i] = sdo.DocumentPathItemSDO{ID: p.ID, Title: p.Title}
		}
	}
	return dto
}

func toSharedDocumentSummaryDTO(row service.SharedDocument) sdo.DocumentSummaryDTO {
	access := row.Access
	dto := documentSummaryDTO(row.Document, row.Facts, "", &access)
	dto.EditLock = documentRowEditLockSDO(row.EditLock)
	dto.ShareScope = documentRowShareScopeSDO(row.ShareScope)
	return dto
}

func documentRowShareScopeSDO(scope *service.DocumentShareScope) *sdo.DocumentShareScopeSDO {
	if scope == nil {
		return nil
	}
	return &sdo.DocumentShareScopeSDO{
		HomeWorkspace: scope.HomeWorkspace,
		Users:         scope.Users,
		Workspaces:    scope.Workspaces,
		Organization:  scope.Organization,
		PublicLink:    scope.PublicLink,
	}
}

// documentSummaryDTO renders one list row: document metadata, its size and
// origin, the search
// snippet when the query matched, and the resolved access only where the
// service computed it (shared-with-me).
func documentSummaryDTO(doc db.Document, facts service.DocumentListFacts, snippet string, access *service.DocumentAccess) sdo.DocumentSummaryDTO {
	out := sdo.DocumentSummaryDTO{
		SizeBytes: facts.SizeBytes, Origin: facts.Origin,
		ID: doc.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
		Kind: doc.Kind, Title: doc.Title, Visibility: doc.Visibility,
		Revision: strconv.FormatInt(doc.Revision, 10), CurrentVersion: doc.CurrentVersion,
		Position: doc.Position, CreatedBy: doc.CreatedBy, CreatedByKind: doc.CreatedByKind,
		UpdatedBy: doc.UpdatedBy, UpdatedByKind: doc.UpdatedByKind,
	}
	if doc.ParentID.Valid {
		out.ParentID = &doc.ParentID.String
	}
	if doc.SystemKind.Valid && doc.SystemKind.String != "" {
		out.SystemKind = &doc.SystemKind.String
	}
	if doc.Icon.Valid && doc.Icon.String != "" {
		out.Icon = &doc.Icon.String
	}
	// The library format of a file row (UNI-1868): absent for a page, a folder
	// and a file neither a verified MIME nor the title names.
	if facts.Format != "" {
		format := facts.Format
		out.Format = &format
	}
	if snippet != "" {
		out.Snippet = &snippet
	}
	if access != nil {
		out.AdminScope = access.AdminScope
		// No level (a locked AdminScope row) leaves my_level and via out.
		if access.Level != service.DocumentLevelNone {
			level, via := string(access.Level), string(access.Via)
			out.MyLevel = &level
			out.Via = &via
		}
	}
	if doc.OwnerKind.Valid && doc.OwnerKind.String != "" {
		out.OwnerKind = &doc.OwnerKind.String
	}
	if doc.OwnerID.Valid && doc.OwnerID.String != "" {
		out.OwnerID = &doc.OwnerID.String
	}
	if doc.ArchivedAt.Valid {
		at := doc.ArchivedAt.Time.UTC().Format(time.RFC3339)
		out.ArchivedAt = &at
	}
	if doc.ArchivedBy.Valid && doc.ArchivedBy.String != "" {
		by := doc.ArchivedBy.String
		out.ArchivedBy = &by
	}
	if doc.PurgeAfter.Valid {
		after := doc.PurgeAfter.Time.UTC().Format(time.RFC3339)
		out.PurgeAfter = &after
	}
	// ARCHIVE-01 (spec Q-UI3): shelved_at/shelved_by ride on every list row,
	// trash rows included, so the trash list can show the "Đã lưu trữ" label.
	if doc.ShelvedAt.Valid {
		at := doc.ShelvedAt.Time.UTC().Format(time.RFC3339)
		out.ShelvedAt = &at
	}
	if doc.ShelvedBy.Valid && doc.ShelvedBy.String != "" {
		by := doc.ShelvedBy.String
		out.ShelvedBy = &by
	}
	if doc.CreatedAt.Valid {
		out.CreatedAt = doc.CreatedAt.Time.UTC().Format(time.RFC3339)
	}
	if doc.UpdatedAt.Valid {
		out.UpdatedAt = doc.UpdatedAt.Time.UTC().Format(time.RFC3339)
	}
	return out
}

// documentTreeDTOs renders the service tree; every level keeps the service's
// order and an empty children array rather than null.
func documentTreeDTOs(nodes []service.DocumentTreeNode) []sdo.DocumentTreeNodeDTO {
	out := make([]sdo.DocumentTreeNodeDTO, 0, len(nodes))
	for _, n := range nodes {
		dto := sdo.DocumentTreeNodeDTO{
			ID: n.ID, Title: n.Title, Kind: n.Kind, Position: n.Position,
			Children: documentTreeDTOs(n.Children),
			EditLock: documentRowEditLockSDO(n.EditLock),
		}
		if n.ParentID != "" {
			parent := n.ParentID
			dto.ParentID = &parent
		}
		if n.SystemKind != "" {
			sys := n.SystemKind
			dto.SystemKind = &sys
		}
		if n.Icon != "" {
			icon := n.Icon
			dto.Icon = &icon
		}
		out = append(out, dto)
	}
	return out
}

// documentArchiveSDO renders archive/restore: the document view, the batch id
// the command wrote (absent on legacy rows) and the affected ids (always an
// array, never null).
func documentArchiveSDO(res service.DocumentArchiveResult) sdo.DocumentArchiveSDO {
	out := sdo.DocumentArchiveSDO{Document: documentDTO(res.View), Affected: res.Affected}
	if out.Affected == nil {
		out.Affected = []string{}
	}
	if res.BatchID != "" {
		batch := res.BatchID
		out.BatchID = &batch
	}
	return out
}

// documentArchiveImpactSDO renders the counts the delete dialog shows.
func documentArchiveImpactSDO(impact service.DocumentArchiveImpact) sdo.DocumentArchiveImpactSDO {
	return sdo.DocumentArchiveImpactSDO{
		Folders:   impact.Folders,
		Documents: impact.Documents,
		Total:     impact.Total,
		MaxNodes:  impact.MaxNodes,
		TooLarge:  impact.TooLarge,
	}
}

// documentAccessLogCursor pins the (occurred_at, id) keyset of the last row
// returned; the service windows the next page with the same pair, so rows
// sharing the boundary timestamp cannot be skipped. Opaque to the client.
type documentAccessLogCursor struct {
	At time.Time `json:"t"`
	ID string    `json:"id"`
}

func encodeDocumentAccessLogCursor(at time.Time, id string) string {
	raw, _ := json.Marshal(documentAccessLogCursor{At: at.UTC(), ID: id})
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeDocumentAccessLogCursor(s string) (time.Time, string, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return time.Time{}, "", false
	}
	var c documentAccessLogCursor
	if err := json.Unmarshal(raw, &c); err != nil || c.At.IsZero() {
		return time.Time{}, "", false
	}
	return c.At, c.ID, true
}

// sharedWithMeCursor pins the (created_at, id) keyset of the last candidate
// the shared-with-me walk read; the service resumes strictly after that pair.
// Opaque to the client.
type sharedWithMeCursor struct {
	At time.Time `json:"t"`
	ID string    `json:"id"`
}

func encodeSharedWithMeCursor(at time.Time, id string) string {
	raw, _ := json.Marshal(sharedWithMeCursor{At: at.UTC(), ID: id})
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeSharedWithMeCursor(s string) (time.Time, string, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return time.Time{}, "", false
	}
	var c sharedWithMeCursor
	if err := json.Unmarshal(raw, &c); err != nil || c.At.IsZero() || c.ID == "" {
		return time.Time{}, "", false
	}
	return c.At, c.ID, true
}
