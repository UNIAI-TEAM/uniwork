package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Document sharing HTTP (C-01 §5.3/§5.4; UNI-679, G1-05b): the access
// overview, grant/revoke, the public-link create/revoke (token returned
// exactly once) and the manage-only access log. Every route goes through
// DocumentService; the handler never decides a level and never stores a token.

// listDocumentShares is GET /documents/{documentID}/shares: the caller's own
// level always, the grants/acl-owner/live links only at manage level.
func (h *handlers) listDocumentShares(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	overview, err := h.Documents.DocumentAccessList(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.DocumentAccessSDO{MyLevel: string(overview.My.Level), Via: string(overview.My.Via)}
	if overview.ACLOwner != nil {
		out.ACLOwner = &sdo.DocumentPersonAccessDTO{
			UserID: overview.ACLOwner.UserID,
			Level:  string(overview.ACLOwner.Access.Level),
			Via:    string(overview.ACLOwner.Access.Via),
		}
	}
	for _, sh := range overview.Shares {
		out.Shares = append(out.Shares, documentShareDTO(sh))
	}
	for _, link := range overview.Links {
		out.Links = append(out.Links, documentLinkDTO(link))
	}
	respondJSON(w, http.StatusOK, out)
}

// createDocumentShare is POST /documents/{documentID}/shares: grant a level
// to a user/workspace/organization inside the document's organization.
func (h *handlers) createDocumentShare(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.ShareDocumentSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	sh, err := h.Documents.ShareDocument(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"), service.DocumentShareInput{
		PrincipalType: strings.TrimSpace(in.PrincipalType),
		PrincipalID:   strings.TrimSpace(in.PrincipalID),
		Level:         service.DocumentLevel(strings.TrimSpace(in.Level)),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, sdo.DocumentShareSDO{Share: documentShareDTO(service.DocumentShareAccess{Share: sh, Active: true})})
}

// revokeDocumentShare is DELETE /documents/{documentID}/shares/{shareID}.
func (h *handlers) revokeDocumentShare(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	err := h.Documents.RevokeDocumentShare(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "documentID"), chi.URLParam(r, "shareID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

// createDocumentLink is POST /documents/{documentID}/links: an anonymous view
// link. The raw token rides this response only; the database keeps its hash.
func (h *handlers) createDocumentLink(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.CreateDocumentLinkSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	days := 0
	if in.ExpiresInDays != nil {
		days = *in.ExpiresInDays
	}
	created, err := h.Documents.CreateDocumentLink(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"), days)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, sdo.DocumentLinkSDO{
		Link: documentLinkDTO(created.Link), Token: created.Token, URL: "/share/" + created.Token,
	})
}

// revokeDocumentLink is DELETE /documents/{documentID}/links/{linkID}: the
// next public read with that token is not found.
func (h *handlers) revokeDocumentLink(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	err := h.Documents.RevokeDocumentLink(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "documentID"), chi.URLParam(r, "linkID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

// listDocumentAccessLogs is GET /documents/{documentID}/access-logs (manage):
// newest first, actor resolved through ActorService. A display-name lookup
// that fails leaves the actor block out; it never fails the log read.
func (h *handlers) listDocumentAccessLogs(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	q := r.URL.Query()
	query := service.DocumentAccessLogQuery{Action: strings.TrimSpace(q.Get("action"))}
	if raw := strings.TrimSpace(q.Get("cursor")); raw != "" {
		at, id, ok := decodeDocumentAccessLogCursor(raw)
		if !ok {
			respondError(w, http.StatusBadRequest, "invalid_request", "cursor không hợp lệ")
			return
		}
		query.Before = at
		query.BeforeID = id
	}
	limit := 0
	if raw := strings.TrimSpace(q.Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			respondError(w, http.StatusBadRequest, "invalid_request", "limit must be a non-negative integer")
			return
		}
		limit = n
	}
	query.Limit = limit

	rows, err := h.Documents.ListDocumentAccessLogs(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"), query)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	actors := h.resolveDocumentLogActors(r, rows)
	out := sdo.DocumentAccessLogListSDO{Logs: make([]sdo.DocumentAccessLogDTO, 0, len(rows))}
	for _, row := range rows {
		out.Logs = append(out.Logs, documentAccessLogDTO(row, actors))
	}
	if effective := service.EffectiveDocumentAccessLogLimit(limit); len(rows) == effective {
		last := rows[len(rows)-1]
		cursor := encodeDocumentAccessLogCursor(last.OccurredAt.Time, last.ID)
		out.NextCursor = &cursor
	}
	respondJSON(w, http.StatusOK, out)
}

// resolveDocumentLogActors batch-resolves every human/agent actor of the
// page. Anonymous rows and ids that no longer resolve simply have no actor
// block; the raw actor_kind/actor_id always stay on the row.
func (h *handlers) resolveDocumentLogActors(r *http.Request, rows []db.DocumentAccessLog) map[service.ActorRef]sdo.ActorDTO {
	out := map[service.ActorRef]sdo.ActorDTO{}
	if h.Actors == nil {
		return out
	}
	refs := make([]service.ActorRef, 0, len(rows))
	for _, row := range rows {
		if !row.ActorID.Valid || row.ActorID.String == "" {
			continue
		}
		// The stored kind is read, never chosen: a row records human/agent/
		// anonymous, and only the two former are resolvable.
		switch row.ActorKind {
		case "human", "agent":
			refs = append(refs, service.ActorRef{Kind: audit.Kind(row.ActorKind), ID: row.ActorID.String})
		}
	}
	if len(refs) == 0 {
		return out
	}
	infos, err := h.Actors.Resolve(r.Context(), refs)
	if err != nil {
		h.Log.Warn("document access log actor resolve failed", "err", err)
		return out
	}
	for ref, info := range infos {
		out[ref] = sdo.ActorDTO{ID: info.ID, Kind: string(info.Kind), DisplayName: info.DisplayName, AvatarURL: info.AvatarURL}
	}
	return out
}

func documentAccessLogDTO(row db.DocumentAccessLog, actors map[service.ActorRef]sdo.ActorDTO) sdo.DocumentAccessLogDTO {
	out := sdo.DocumentAccessLogDTO{
		ID: row.ID, Action: row.Action, Via: row.Via, ActorKind: row.ActorKind,
	}
	if row.Version.Valid {
		v := row.Version.Int32
		out.Version = &v
	}
	if row.ActorID.Valid && row.ActorID.String != "" {
		id := row.ActorID.String
		out.ActorID = &id
		if actor, ok := actors[service.ActorRef{Kind: audit.Kind(row.ActorKind), ID: id}]; ok {
			actorCopy := actor
			out.Actor = &actorCopy
		}
	}
	if row.ShareLinkID.Valid && row.ShareLinkID.String != "" {
		link := row.ShareLinkID.String
		out.ShareLinkID = &link
	}
	if row.OccurredAt.Valid {
		out.OccurredAt = row.OccurredAt.Time.UTC().Format(time.RFC3339)
	}
	return out
}

// documentShareDTO renders one grant with its effective access when known.
func documentShareDTO(sh service.DocumentShareAccess) sdo.DocumentShareDTO {
	out := sdo.DocumentShareDTO{
		ID: sh.Share.ID, PrincipalType: sh.Share.PrincipalType, PrincipalID: sh.Share.PrincipalID,
		Level: sh.Share.Level, Active: sh.Active,
		GrantedBy: sh.Share.GrantedBy, GrantedByKind: sh.Share.GrantedByKind,
	}
	if sh.Effective.Level != "" {
		level := string(sh.Effective.Level)
		out.EffectiveLevel = &level
	}
	if sh.Effective.Via != "" {
		via := string(sh.Effective.Via)
		out.EffectiveVia = &via
	}
	if sh.Share.CreatedAt.Valid {
		out.CreatedAt = sh.Share.CreatedAt.Time.UTC().Format(time.RFC3339)
	}
	return out
}

// documentLinkDTO renders one public link row; the token/hash never ride it.
func documentLinkDTO(link db.DocumentShareLink) sdo.DocumentLinkDTO {
	out := sdo.DocumentLinkDTO{
		ID: link.ID, ViewCount: link.ViewCount,
		CreatedBy: link.CreatedBy, CreatedByKind: link.CreatedByKind,
	}
	if link.ExpiresAt.Valid {
		at := link.ExpiresAt.Time.UTC().Format(time.RFC3339)
		out.ExpiresAt = &at
	}
	if link.CreatedAt.Valid {
		out.CreatedAt = link.CreatedAt.Time.UTC().Format(time.RFC3339)
	}
	return out
}
