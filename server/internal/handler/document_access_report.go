package handler

import (
	"encoding/base64"
	"encoding/json"
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
// in: f is the folder, h a hash of the filter, so a cursor never continues a
// different report.
type accessReportCursor struct {
	ID     string `json:"id"`
	Folder string `json:"f"`
	Filter string `json:"h"`
}

// accessReportFilterHash is 8 hex digits over the person, level and
// visibility filters (levels sorted, so their order does not matter).
func accessReportFilterHash(in service.DocumentAccessReportQuery) string {
	levels := append([]string(nil), in.Levels...)
	sort.Strings(levels)
	h := fnv.New32a()
	_, _ = h.Write([]byte(in.PersonID + "|" + strings.Join(levels, ",") + "|" + in.Visibility))
	return fmt.Sprintf("%08x", h.Sum32())
}

func encodeAccessReportCursor(c accessReportCursor) string {
	raw, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(raw)
}

// accessReportQuery reads the filters both routes share. A value the service
// refuses (an unknown level or visibility) comes back from it as 400.
func accessReportQuery(r *http.Request) service.DocumentAccessReportQuery {
	q := r.URL.Query()
	in := service.DocumentAccessReportQuery{
		FolderID:   strings.TrimSpace(q.Get("folder_id")),
		PersonID:   strings.TrimSpace(q.Get("person_id")),
		Visibility: strings.TrimSpace(q.Get("visibility")),
	}
	for _, l := range strings.Split(q.Get("level"), ",") {
		if l = strings.TrimSpace(l); l != "" {
			in.Levels = append(in.Levels, l)
		}
	}
	return in
}

// documentAccessReport is GET /workspaces/{workspaceID}/documents/access-report.
func (h *handlers) documentAccessReport(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	in := accessReportQuery(r)
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			respondError(w, http.StatusBadRequest, "invalid_request", "limit must be a non-negative integer")
			return
		}
		in.Limit = n
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("cursor")); raw != "" {
		var c accessReportCursor
		dec, err := base64.RawURLEncoding.DecodeString(raw)
		if err != nil || json.Unmarshal(dec, &c) != nil || c.ID == "" ||
			c.Folder != in.FolderID || c.Filter != accessReportFilterHash(in) {
			respondError(w, http.StatusBadRequest, "invalid_request", "cursor không hợp lệ")
			return
		}
		in.AfterID = c.ID
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
	if page.NextAfterID != "" {
		cursor := encodeAccessReportCursor(accessReportCursor{ID: page.NextAfterID, Folder: in.FolderID, Filter: accessReportFilterHash(in)})
		out.NextCursor = &cursor
	}
	respondJSON(w, http.StatusOK, out)
}

func accessReportFilterDTO(in service.DocumentAccessReportQuery) sdo.DocumentAccessReportFilterDTO {
	out := sdo.DocumentAccessReportFilterDTO{Level: append([]string{}, in.Levels...)}
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
	in := accessReportQuery(r)
	ew := &accessReportExportWriter{ResponseWriter: w}
	_, err := h.Documents.ExportDocumentAccessReport(r.Context(), service.Human(middleware.UserID(r.Context())),
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
