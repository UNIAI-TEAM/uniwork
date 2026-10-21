package handler

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// Document access report HTTP (UNI-1643). The service decides every level
// and resolves every name; the handler parses the query, guards the cursor
// and writes the wire shape (contract v1 §3-§4, §7).

// accessReportCursor pins the last candidate read and the scope it was read
// in: f is the folder, h a hash of the filter, s and o the sort and order it
// walks, so a cursor never continues a different report. It carries ids and
// scope only (UNI-2039 fx1): the last candidate read may be a document the
// caller cannot read, so its title or change time never travels here; the
// service looks the sort value up from the id inside the tenant-constrained
// read. The token is sealed with the server secret (UNI-2039 L1) and binds
// the workspace and the caller too, so the anchor id cannot be forged,
// re-aimed at another sort or scope, or replayed by another account to learn
// where an unreadable document sits in the walk.
type accessReportCursor struct {
	ID        string `json:"id"`
	Folder    string `json:"f"`
	Filter    string `json:"h"`
	Sort      string `json:"s"`
	Order     string `json:"o"`
	Workspace string `json:"w"`
	User      string `json:"u"`
}

// accessReportCursorPrefix tags the sealed token format; a new format takes a
// new prefix.
const accessReportCursorPrefix = "acr1."

// accessReportCursorMAC is the signature over the prefixed payload. The key is
// derived from the server secret under its own label, so an access-report
// cursor can never pass for a change-feed cursor, an access token or a frame
// token (compare newChangeCursorCodec in package service).
func accessReportCursorMAC(secret, body string) []byte {
	k := hmac.New(sha256.New, []byte(secret))
	k.Write([]byte("uniwork/document-access-report-cursor/v1"))
	m := hmac.New(sha256.New, k.Sum(nil))
	m.Write([]byte(body))
	return m.Sum(nil)
}

// accessReportFilterHash is 8 hex digits over the person, level and
// visibility filters (levels sorted, so their order does not matter).
func accessReportFilterHash(in service.DocumentAccessReportQuery) string {
	levels := append([]string(nil), in.Levels...)
	sort.Strings(levels)
	sources := append([]string(nil), in.Sources...)
	sort.Strings(sources)
	nonDefault := "0"
	if in.NonDefault {
		nonDefault = "1"
	}
	h := fnv.New32a()
	// The pre-UNI-2039 filters first, then the S5 ones, so the hash of a
	// request that sets none of the new filters keeps only the old part
	// followed by empty fields.
	_, _ = h.Write([]byte(in.PersonID + "|" + strings.Join(levels, ",") + "|" + in.Visibility +
		"|" + in.Q + "|" + in.PrincipalType + ":" + in.PrincipalID + "|" + in.Scope + "|" + strings.Join(sources, ",") +
		"|" + in.Flag + "|" + nonDefault))
	return fmt.Sprintf("%08x", h.Sum32())
}

func encodeAccessReportCursor(secret string, c accessReportCursor) string {
	raw, _ := json.Marshal(c)
	body := accessReportCursorPrefix + base64.RawURLEncoding.EncodeToString(raw)
	return body + "." + base64.RawURLEncoding.EncodeToString(accessReportCursorMAC(secret, body))
}

// accessReportQuery reads the filters both routes share. A value the service
// refuses (an unknown level or visibility) comes back from it as 400.
func accessReportQuery(r *http.Request) (service.DocumentAccessReportQuery, error) {
	q := r.URL.Query()
	in := service.DocumentAccessReportQuery{
		FolderID:   strings.TrimSpace(q.Get("folder_id")),
		PersonID:   strings.TrimSpace(q.Get("person_id")),
		Visibility: strings.TrimSpace(q.Get("visibility")),
		Sort:       strings.TrimSpace(q.Get("sort")),
		Order:      strings.TrimSpace(q.Get("order")),
		Q:          strings.TrimSpace(q.Get("q")),
		Scope:      strings.TrimSpace(q.Get("scope")),
		Flag:       strings.TrimSpace(q.Get("flag")),
	}
	in.Levels = splitAccessReportList(q.Get("level"))
	in.Sources = splitAccessReportList(q.Get("source"))
	switch strings.TrimSpace(q.Get("non_default")) {
	case "", "0":
	case "1", "true":
		in.NonDefault = true
	default:
		return in, errors.New("non_default phải là 1 hoặc 0")
	}
	if raw := strings.TrimSpace(q.Get("principal")); raw != "" {
		typ, id, _ := strings.Cut(raw, ":")
		switch {
		case typ == service.DocumentPrincipalUser:
			// user:<id> is person_id's long form: one filter, one meaning.
			if id == "" || (in.PersonID != "" && in.PersonID != id) {
				return in, errors.New("principal user cần id và khớp person_id")
			}
			in.PersonID = id
		case typ == service.AccessReportSourceLink, typ == service.DocumentPrincipalWorkspace, typ == service.DocumentPrincipalOrganization:
			in.PrincipalType, in.PrincipalID = typ, id
		default:
			return in, errors.New("principal không hợp lệ")
		}
	}
	return in, nil
}

// splitAccessReportList reads a comma-separated filter list.
func splitAccessReportList(raw string) []string {
	var out []string
	for _, v := range strings.Split(raw, ",") {
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// documentAccessReport is GET /workspaces/{workspaceID}/documents/access-report.
func (h *handlers) documentAccessReport(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	in, err := accessReportQuery(r)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			respondError(w, http.StatusBadRequest, "invalid_request", "limit must be a non-negative integer")
			return
		}
		in.Limit = n
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("cursor")); raw != "" {
		after, ok := decodeAccessReportCursor(h.Cfg.JWTSecret, raw, h.accessReportCursorScope(r, in))
		if !ok {
			respondError(w, http.StatusBadRequest, "invalid_request", "cursor không hợp lệ")
			return
		}
		in.After = after
	}
	page, err := h.Documents.DocumentAccessReport(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"), in)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.DocumentAccessReportSDO{
		Scope:       sdo.DocumentAccessReportScopeDTO{Kind: "workspace", WorkspaceID: chi.URLParam(r, "workspaceID")},
		Filter:      accessReportFilterDTO(in),
		GeneratedAt: page.GeneratedAt.UTC().Format(time.RFC3339),
		Documents:   make([]sdo.DocumentAccessReportDocumentDTO, 0, len(page.Items)),
		Summary:     sdo.DocumentAccessReportSummaryDTO{Candidates: page.Candidates, Skipped: page.Skipped},
	}
	if page.FolderID != "" {
		folderID, title := page.FolderID, page.FolderTitle
		out.Scope.Kind, out.Scope.FolderID, out.Scope.FolderTitle = "folder", &folderID, &title
	}
	for _, it := range page.Items {
		out.Documents = append(out.Documents, accessReportDocumentDTO(it, in.PersonID != ""))
		out.Summary.Rows += len(it.Rows)
	}
	out.Summary.Documents = len(out.Documents)
	if page.Next != nil {
		cursor := encodeAccessReportCursor(h.Cfg.JWTSecret, newAccessReportCursor(h.accessReportCursorScope(r, in), in, *page.Next))
		out.NextCursor = &cursor
	}
	respondJSON(w, http.StatusOK, out)
}

// accessReportCursorScope is what the request presenting a cursor stands in:
// the report (folder, filters, sort, order) in this workspace for this caller.
func (h *handlers) accessReportCursorScope(r *http.Request, in service.DocumentAccessReportQuery) accessReportCursor {
	c := newAccessReportCursor(accessReportCursor{}, in, service.AccessReportKey{})
	c.Workspace = chi.URLParam(r, "workspaceID")
	c.User = middleware.UserID(r.Context())
	return c
}

// newAccessReportCursor pins the position after key in the report in describes;
// scope carries the workspace and caller the token is bound to.
func newAccessReportCursor(scope accessReportCursor, in service.DocumentAccessReportQuery, key service.AccessReportKey) accessReportCursor {
	mode, descending := in.SortOrder()
	order := service.AccessReportOrderAsc
	if descending {
		order = service.AccessReportOrderDesc
	}
	return accessReportCursor{
		ID: key.ID, Folder: in.FolderID, Filter: accessReportFilterHash(in), Sort: mode, Order: order,
		Workspace: scope.Workspace, User: scope.User,
	}
}

// decodeAccessReportCursor reads a cursor and checks it was sealed by this
// server and belongs to this very report: workspace, caller, folder, filter
// hash, sort and order all match (ok=false otherwise, for a tampered, foreign,
// truncated or unsigned token alike).
func decodeAccessReportCursor(secret, raw string, want accessReportCursor) (*service.AccessReportKey, bool) {
	rest, ok := strings.CutPrefix(raw, accessReportCursorPrefix)
	if !ok {
		return nil, false
	}
	payload, sig, ok := strings.Cut(rest, ".")
	if !ok || payload == "" || sig == "" {
		return nil, false
	}
	// Strict: one spelling per MAC.
	got, err := base64.RawURLEncoding.Strict().DecodeString(sig)
	if err != nil || !hmac.Equal(got, accessReportCursorMAC(secret, accessReportCursorPrefix+payload)) {
		return nil, false
	}
	var c accessReportCursor
	dec, err := base64.RawURLEncoding.Strict().DecodeString(payload)
	if err != nil || json.Unmarshal(dec, &c) != nil || c.ID == "" {
		return nil, false
	}
	if c.Workspace != want.Workspace || c.User != want.User || c.Folder != want.Folder ||
		c.Filter != want.Filter || c.Sort != want.Sort || c.Order != want.Order {
		return nil, false
	}
	return &service.AccessReportKey{ID: c.ID}, true
}

func accessReportFilterDTO(in service.DocumentAccessReportQuery) sdo.DocumentAccessReportFilterDTO {
	mode, descending := in.SortOrder()
	order := service.AccessReportOrderAsc
	if descending {
		order = service.AccessReportOrderDesc
	}
	out := sdo.DocumentAccessReportFilterDTO{
		Level: append([]string{}, in.Levels...), Sort: mode, Order: order,
		Source: append([]string{}, in.Sources...), NonDefault: in.NonDefault,
		Q: optionalString(in.Q), Scope: optionalString(in.Scope), Flag: optionalString(in.Flag),
	}
	if ref := in.PrincipalRef(); ref != "" {
		out.Principal = &ref
	} else if in.PersonID != "" {
		ref := service.DocumentPrincipalUser + ":" + in.PersonID
		out.Principal = &ref
	}
	if in.PersonID != "" {
		p := in.PersonID
		out.PersonID = &p
	}
	if in.Visibility != "" {
		v := in.Visibility
		out.Visibility = &v
	}
	return out
}

// accessReportLevelString is the wire form of the caller's level.
func accessReportLevelString(l service.DocumentLevel) string {
	if l == service.DocumentLevelNone {
		return "none"
	}
	return string(l)
}

func optionalString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func accessReportDocumentDTO(it service.DocumentAccessReportItem, withPerson bool) sdo.DocumentAccessReportDocumentDTO {
	doc := it.Item.Document
	info := sdo.DocumentAccessReportDocumentInfoDTO{
		ID: doc.ID, Title: doc.Title, Kind: doc.Kind, Visibility: doc.Visibility,
		Path:          make([]sdo.DocumentPathItemSDO, 0, len(it.Item.Path)),
		LiveLinkCount: it.LiveLinkCount,
		GeneralScope:  sdo.DocumentAccessReportGeneralScopeDTO{Kind: it.GeneralScope, Level: optionalString(it.GeneralLevel)},
		Flags:         append([]string{}, it.Flags...),
		MyLevel:       accessReportLevelString(it.Item.Access.Level),
		AdminScope:    it.Item.Access.AdminScope,
	}
	if !it.AccessChangedAt.IsZero() {
		info.AccessChangedAt = it.AccessChangedAt.UTC().Format(time.RFC3339)
	}
	for _, p := range it.Item.Path {
		info.Path = append(info.Path, sdo.DocumentPathItemSDO{ID: p.ID, Title: p.Title})
	}
	if doc.AclOwnerID.Valid {
		info.ACLOwner = &sdo.DocumentAccessReportOwnerDTO{ID: doc.AclOwnerID.String, Name: optionalString(it.ACLOwnerName)}
	}
	if withPerson {
		level := string(it.PersonLevel)
		if level == "" {
			level = "none"
		}
		info.PersonLevel = &level
	}
	if doc.UpdatedAt.Valid {
		info.UpdatedAt = doc.UpdatedAt.Time.UTC().Format(time.RFC3339)
	}
	out := sdo.DocumentAccessReportDocumentDTO{Document: info, Rows: make([]sdo.DocumentAccessReportRowDTO, 0, len(it.Rows))}
	for _, row := range it.Rows {
		dto := sdo.DocumentAccessReportRowDTO{
			Source: row.Source, Via: row.Via, PrincipalType: row.PrincipalType, PrincipalID: row.PrincipalID,
			PrincipalName: optionalString(row.PrincipalName), Level: row.Level, EffectiveLevel: row.EffectiveLevel,
			Active: row.Active, GrantedBy: optionalString(row.GrantedBy), GrantedByName: optionalString(row.GrantedByName),
			GrantedByKind: optionalString(row.GrantedByKind), ShareID: optionalString(row.ShareID),
		}
		if row.GrantedAt != nil {
			at := row.GrantedAt.UTC().Format(time.RFC3339)
			dto.GrantedAt = &at
		}
		if row.RevokeKind != "" {
			dto.RevokeTarget = &sdo.DocumentAccessReportRevokeTargetDTO{Kind: row.RevokeKind, ID: row.RevokeID}
		}
		dto.Origin = optionalString(row.Origin)
		if row.ExpiresAt != nil {
			at := row.ExpiresAt.UTC().Format(time.RFC3339)
			dto.ExpiresAt = &at
		}
		out.Rows = append(out.Rows, dto)
	}
	return out
}

// accessReportExportWriter sets the file headers from the export's facts
// just before the first byte; until then a refusal can still answer JSON.
type accessReportExportWriter struct {
	http.ResponseWriter
	started bool
}

func (w *accessReportExportWriter) StartAccessReportExport(e service.DocumentAccessReportExport) {
	ct := "text/csv; charset=utf-8"
	if e.Format == service.AccessReportFormatXLSX {
		ct = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	}
	hd := w.Header()
	hd.Set("Content-Type", ct)
	hd.Set("Content-Disposition", `attachment; filename="`+e.FileName+`"`)
	hd.Set("X-Report-Rows", strconv.Itoa(e.Rows))
	hd.Set("X-Report-Skipped", strconv.Itoa(e.Skipped))
	hd.Set("X-Report-Generated-At", e.GeneratedAt.UTC().Format(time.RFC3339))
	w.started = true
	w.WriteHeader(http.StatusOK)
}

// exportDocumentAccessReport is GET
// /workspaces/{workspaceID}/documents/access-report/export.
func (h *handlers) exportDocumentAccessReport(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	in, err := accessReportQuery(r)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	ew := &accessReportExportWriter{ResponseWriter: w}
	_, err = h.Documents.ExportDocumentAccessReport(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), in, strings.TrimSpace(r.URL.Query().Get("format")), ew)
	if err == nil {
		return
	}
	if ew.started {
		// The file is already on the wire; all that is left is the log.
		h.Log.Error("document access report export", "err", err)
		return
	}
	h.mapServiceError(w, err)
}

// documentAccessReportSummary is GET
// /workspaces/{workspaceID}/documents/access-report/summary (UNI-2039 S6).
func (h *handlers) documentAccessReportSummary(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	in, err := accessReportQuery(r)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	sum, err := h.Documents.DocumentAccessReportSummary(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"), in)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DocumentAccessReportSummaryResultSDO{
		GeneratedAt: sum.GeneratedAt.UTC().Format(time.RFC3339),
		Tiles: sdo.DocumentAccessReportTilesDTO{
			PublicLink: sum.Tiles.PublicLink, OutsideWorkspace: sum.Tiles.OutsideWorkspace, DirectManage: sum.Tiles.DirectManage,
			Documents: sum.Tiles.Documents, Restricted: sum.Tiles.Restricted, Workspace: sum.Tiles.Workspace, Organization: sum.Tiles.Organization,
		},
		MatchingDocuments: sum.MatchingDocuments, Skipped: sum.Skipped, Truncated: sum.Truncated,
	})
}

// documentAccessReportPrincipals is GET
// /workspaces/{workspaceID}/documents/access-report/principals (UNI-2039 S7).
func (h *handlers) documentAccessReportPrincipals(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	q := r.URL.Query()
	in := service.DocumentAccessReportPrincipalsQuery{
		FolderID: strings.TrimSpace(q.Get("folder_id")),
		Q:        strings.TrimSpace(q.Get("q")),
		Kind:     strings.TrimSpace(q.Get("kind")),
		Levels:   splitAccessReportList(q.Get("level")),
		Sort:     strings.TrimSpace(q.Get("sort")),
		Order:    strings.TrimSpace(q.Get("order")),
	}
	res, err := h.Documents.DocumentAccessReportPrincipals(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"), in)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.DocumentAccessReportPrincipalsSDO{
		GeneratedAt: res.GeneratedAt.UTC().Format(time.RFC3339),
		Principals:  make([]sdo.DocumentAccessReportPrincipalDTO, 0, len(res.Principals)),
		Truncated:   res.Truncated,
	}
	for _, p := range res.Principals {
		out.Principals = append(out.Principals, sdo.DocumentAccessReportPrincipalDTO{
			PrincipalType: p.PrincipalType, PrincipalID: optionalString(p.PrincipalID), PrincipalName: optionalString(p.PrincipalName),
			Kind: p.Kind, MemberCount: p.MemberCount, DocumentCount: p.DocumentCount, MainSource: p.MainSource,
			Levels: sdo.DocumentAccessReportLevelSplitDTO{
				View: p.Levels["view"], Comment: p.Levels["comment"], Edit: p.Levels["edit"], Manage: p.Levels["manage"],
			},
		})
	}
	respondJSON(w, http.StatusOK, out)
}
