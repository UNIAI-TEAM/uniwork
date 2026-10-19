package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// Document access requests HTTP (DOC-07, UNI-1631; §4.3). A person who cannot
// read a document asks its managers for a level; the answer is uniform (202
// {"status":"sent"}) for every well-formed id, so the route never proves the
// document exists. Every rule lives in DocumentService; the handler decodes,
// maps and writes.

// createDocumentAccessRequest is POST
// /documents/{documentID}/access-requests: ask the people who manage the
// document for a level. 202 for every syntactically valid send, except the two
// answers about the caller's OWN requests on that document: 409
// access_request_pending and 429 access_request_cooldown with Retry-After.
func (h *handlers) createDocumentAccessRequest(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.CreateDocumentAccessRequestSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	res, err := h.Documents.CreateDocumentAccessRequest(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "documentID"), service.DocumentAccessRequestInput{
			RequestedLevel: derefString(in.RequestedLevel),
			Message:        derefString(in.Message),
			SourceKind:     derefString(in.SourceKind),
			SourceID:       derefString(in.SourceID),
		})
	if err != nil {
		h.accessRequestError(w, err)
		return
	}
	respondJSON(w, http.StatusAccepted, sdo.DocumentAccessRequestSentSDO{Status: res.Status})
}

// accessRequestError answers a refused create. It is mapServiceError plus the
// one header the cooldown needs: Retry-After carries the same seconds as
// fields.retry_after_seconds, so the header and the body always agree. The
// shared helper reads Fields["retry_after"], which this code does not use, so
// the field is read here by its own name.
func (h *handlers) accessRequestError(w http.ResponseWriter, err error) {
	if retry, ok := accessRequestRetryAfter(err); ok {
		w.Header().Set("Retry-After", retry)
	}
	h.mapServiceError(w, err)
}

// accessRequestRetryAfter formats Fields["retry_after_seconds"] for the
// Retry-After header; a refusal that is not a CodedError, or carries no such
// field, has nothing to wait out.
func accessRequestRetryAfter(err error) (string, bool) {
	var ce service.CodedError
	if !errors.As(err, &ce) {
		return "", false
	}
	switch v := ce.Fields["retry_after_seconds"].(type) {
	case int:
		return strconv.Itoa(v), true
	case int64:
		return strconv.FormatInt(v, 10), true
	case float64:
		return strconv.Itoa(int(v)), true
	}
	return "", false
}

// listDocumentAccessRequests is GET /documents/{documentID}/access-requests:
// the pending, unexpired requests. A reader who may not administer the document
// gets an empty list, never a 403.
func (h *handlers) listDocumentAccessRequests(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	views, err := h.Documents.ListDocumentAccessRequests(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "documentID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.DocumentAccessRequestListSDO{Requests: make([]sdo.DocumentAccessRequestDTO, 0, len(views))}
	for _, v := range views {
		out.Requests = append(out.Requests, documentAccessRequestDTO(v))
	}
	respondJSON(w, http.StatusOK, out)
}

// approveDocumentAccessRequest is POST
// /documents/{documentID}/access-requests/{requestID}/approve: grant the
// requester a level (default = the level asked for) and close the request.
func (h *handlers) approveDocumentAccessRequest(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.ApproveDocumentAccessRequestSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	decision, err := h.Documents.ApproveDocumentAccessRequest(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "documentID"), chi.URLParam(r, "requestID"), derefString(in.Level))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DocumentAccessRequestDecisionSDO{
		ID: decision.ID, Status: decision.Status, ShareID: decision.ShareID,
	})
}

// declineDocumentAccessRequest is POST
// /documents/{documentID}/access-requests/{requestID}/decline: close the
// request without granting anything. The route takes no body.
func (h *handlers) declineDocumentAccessRequest(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	decision, err := h.Documents.DeclineDocumentAccessRequest(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "documentID"), chi.URLParam(r, "requestID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DocumentAccessRequestDecisionSDO{
		ID: decision.ID, Status: decision.Status, ShareID: decision.ShareID,
	})
}

// documentAccessRequestDTO renders one pending request. A source the caller
// cannot read reads as null, never as an object with an empty title.
func documentAccessRequestDTO(v service.DocumentAccessRequestView) sdo.DocumentAccessRequestDTO {
	out := sdo.DocumentAccessRequestDTO{
		ID:             v.ID,
		RequesterID:    v.RequesterID,
		RequesterName:  v.RequesterName,
		RequestedLevel: v.RequestedLevel,
		Message:        v.Message,
	}
	if v.Source != nil {
		out.Source = &sdo.DocumentAccessRequestSourceDTO{Kind: v.Source.Kind, ID: v.Source.ID, Title: v.Source.Title}
	}
	if !v.CreatedAt.IsZero() {
		out.CreatedAt = v.CreatedAt.UTC().Format(time.RFC3339)
	}
	if !v.ExpiresAt.IsZero() {
		out.ExpiresAt = v.ExpiresAt.UTC().Format(time.RFC3339)
	}
	return out
}

// derefString reads an optional wire string; an absent field is "".
func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
