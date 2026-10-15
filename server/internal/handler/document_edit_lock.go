package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// Document edit lock routes (UNI-1645, addendum 2026-10-15 §3.1, R1-R10).
// The handlers hand the path ids, the body and the bearer's session to the
// service, which runs the document gate first (404 before any lock or
// request lookup) and decides every answer; they only shape the SDOs. The
// lock answers carry no-store like the offline lease: a tenure id is a key.

func editLockTime(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func editLockTimePtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := editLockTime(*t)
	return &s
}

func editLockTimestamptz(t pgtype.Timestamptz) *string {
	if !t.Valid {
		return nil
	}
	s := editLockTime(t.Time)
	return &s
}

func documentEditLockSDO(v service.DocumentEditLockView) sdo.DocumentEditLockSDO {
	l := v.Lock
	return sdo.DocumentEditLockSDO{
		LockID: l.ID, DocumentID: l.DocumentID, HolderID: l.UserID, Client: l.Client,
		AcquiredAt: editLockTime(l.AcquiredAt.Time), ExpiresAt: editLockTime(l.ExpiresAt.Time),
		OfflineHoldUntil: editLockTimestamptz(l.OfflineHoldUntil), HoldMaxUntil: editLockTimestamptz(v.HoldMaxUntil),
		GrantedVia: l.GrantedVia, HeartbeatIntervalMS: v.HeartbeatInterval.Milliseconds(), TTLMS: v.TTL.Milliseconds(),
		ServerTime: editLockTime(v.ServerTime),
	}
}

func documentEditLockSummarySDO(s service.DocumentEditLockSummary) sdo.DocumentEditLockSummarySDO {
	out := sdo.DocumentEditLockSummarySDO{
		LockID: s.LockID, HolderID: s.HolderID, HolderName: s.HolderName,
		Since: editLockTime(s.Since), ExpiresAt: editLockTime(s.ExpiresAt),
		OfflineHoldUntil: editLockTimePtr(s.OfflineHoldUntil), Reserved: s.Reserved, HeldByMe: s.HeldByMe,
	}
	if s.HolderAvatarURL != "" {
		avatar := s.HolderAvatarURL
		out.HolderAvatarURL = &avatar
	}
	return out
}

func documentEditRequestSDO(v service.DocumentEditRequestView) sdo.DocumentEditRequestSDO {
	r := v.Request
	return sdo.DocumentEditRequestSDO{
		RequestID: r.ID, DocumentID: r.DocumentID, RequesterID: r.RequesterID, RequesterName: v.RequesterName,
		HolderID: r.HolderID, Status: v.Status, CreatedAt: editLockTime(r.CreatedAt.Time),
		ExpiresAt: editLockTime(r.ExpiresAt.Time), AnsweredAt: editLockTimestamptz(r.AnsweredAt),
	}
}

func (h *handlers) editLockDocumentsReady(w http.ResponseWriter) bool {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return false
	}
	return true
}

func editLockActor(r *http.Request) service.Actor {
	return service.Human(middleware.UserID(r.Context()))
}

// getDocumentEditLock is R1 GET /documents/{documentID}/edit-lock: read
// only; the lock id appears only for a manager who is not the holder.
func (h *handlers) getDocumentEditLock(w http.ResponseWriter, r *http.Request) {
	if !h.editLockDocumentsReady(w) {
		return
	}
	st, err := h.Documents.GetDocumentEditLockState(r.Context(), editLockActor(r), chi.URLParam(r, "documentID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.DocumentEditLockStateSDO{
		PendingRequests: make([]sdo.DocumentEditRequestSDO, 0, len(st.PendingRequests)),
		CanTakeOver:     st.CanTakeOver, CanRequest: st.CanRequest, ServerTime: editLockTime(st.ServerTime),
	}
	if st.Lock != nil {
		sum := documentEditLockSummarySDO(*st.Lock)
		out.Lock = &sum
	}
	if st.MyRequest != nil {
		mine := documentEditRequestSDO(*st.MyRequest)
		out.MyRequest = &mine
	}
	for _, p := range st.PendingRequests {
		out.PendingRequests = append(out.PendingRequests, documentEditRequestSDO(p))
	}
	respondOfficeJSON(w, http.StatusOK, out)
}

// acquireDocumentEditLock is R2 POST /documents/{documentID}/edit-lock: 201
// for a new tenure, 200 for the caller's own (same editor) or a claimed
// handover.
func (h *handlers) acquireDocumentEditLock(w http.ResponseWriter, r *http.Request) {
	if !h.editLockDocumentsReady(w) {
		return
	}
	var in sdi.AcquireDocumentEditLockSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	v, err := h.Documents.AcquireDocumentEditLock(r.Context(), editLockActor(r), chi.URLParam(r, "documentID"), service.AcquireDocumentEditLockInput{
		EditorID: strings.TrimSpace(in.EditorID), Client: strings.TrimSpace(in.Client),
		SessionID: middleware.SessionID(r.Context()), MoveFromSelf: in.MoveFromSelf,
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	status := http.StatusOK
	if v.Created {
		status = http.StatusCreated
	}
	respondOfficeJSON(w, status, documentEditLockSDO(v))
}

// heartbeatDocumentEditLock is R3 POST
// /documents/{documentID}/edit-lock/{lockID}/heartbeat.
func (h *handlers) heartbeatDocumentEditLock(w http.ResponseWriter, r *http.Request) {
	if !h.editLockDocumentsReady(w) {
		return
	}
	hb, err := h.Documents.HeartbeatDocumentEditLock(r.Context(), editLockActor(r), chi.URLParam(r, "documentID"), chi.URLParam(r, "lockID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondOfficeJSON(w, http.StatusOK, sdo.DocumentEditHeartbeatSDO{
		LockID: hb.LockID, ExpiresAt: editLockTime(hb.ExpiresAt),
		OfflineHoldUntil: editLockTimePtr(hb.OfflineHoldUntil), ServerTime: editLockTime(hb.ServerTime),
	})
}

// releaseDocumentEditLock is R4 DELETE
// /documents/{documentID}/edit-lock/{lockID}: 204, idempotent.
func (h *handlers) releaseDocumentEditLock(w http.ResponseWriter, r *http.Request) {
	if !h.editLockDocumentsReady(w) {
		return
	}
	if err := h.Documents.ReleaseDocumentEditLock(r.Context(), editLockActor(r), chi.URLParam(r, "documentID"), chi.URLParam(r, "lockID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// takeOverDocumentEditLock is R5 POST
// /documents/{documentID}/edit-lock/take-over (manage).
func (h *handlers) takeOverDocumentEditLock(w http.ResponseWriter, r *http.Request) {
	if !h.editLockDocumentsReady(w) {
		return
	}
	var in sdi.TakeOverDocumentEditLockSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	v, err := h.Documents.TakeOverDocumentEditLock(r.Context(), editLockActor(r), chi.URLParam(r, "documentID"), service.TakeOverDocumentEditLockInput{
		EditorID: strings.TrimSpace(in.EditorID), Client: strings.TrimSpace(in.Client),
		SessionID: middleware.SessionID(r.Context()), ExpectedLockID: strings.TrimSpace(in.ExpectedLockID),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondOfficeJSON(w, http.StatusCreated, documentEditLockSDO(v))
}

// putDocumentEditHold is R6 PUT
// /documents/{documentID}/edit-lock/{lockID}/offline-hold: the device is
// the bearer's own session; a browser session is refused by the service.
func (h *handlers) putDocumentEditHold(w http.ResponseWriter, r *http.Request) {
	if !h.editLockDocumentsReady(w) {
		return
	}
	var in sdi.PutDocumentEditHoldSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	sessionID := ""
	if middleware.DeviceSession(r.Context()) {
		sessionID = middleware.SessionID(r.Context())
	}
	v, err := h.Documents.PutDocumentEditHold(r.Context(), editLockActor(r), chi.URLParam(r, "documentID"), chi.URLParam(r, "lockID"), sessionID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondOfficeJSON(w, http.StatusOK, documentEditLockSDO(v))
}

// clearDocumentEditHold is R7 DELETE
// /documents/{documentID}/edit-lock/{lockID}/offline-hold: back to the TTL;
// idempotent.
func (h *handlers) clearDocumentEditHold(w http.ResponseWriter, r *http.Request) {
	if !h.editLockDocumentsReady(w) {
		return
	}
	v, err := h.Documents.ClearDocumentEditHold(r.Context(), editLockActor(r), chi.URLParam(r, "documentID"), chi.URLParam(r, "lockID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondOfficeJSON(w, http.StatusOK, documentEditLockSDO(v))
}

// createDocumentEditRequest is R8 POST /documents/{documentID}/edit-requests:
// 201 a new request, 200 the caller's open one. The router budgets it per
// person (20/min); the service holds the per-hour database cap.
func (h *handlers) createDocumentEditRequest(w http.ResponseWriter, r *http.Request) {
	if !h.editLockDocumentsReady(w) {
		return
	}
	var in sdi.CreateDocumentEditRequestSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	v, err := h.Documents.CreateDocumentEditRequest(r.Context(), editLockActor(r), chi.URLParam(r, "documentID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	status := http.StatusOK
	if v.Created {
		status = http.StatusCreated
	}
	respondJSON(w, status, documentEditRequestSDO(v))
}

// answerDocumentEditRequest is R9 POST
// /documents/{documentID}/edit-requests/{requestID}/answer (the holder).
func (h *handlers) answerDocumentEditRequest(w http.ResponseWriter, r *http.Request) {
	if !h.editLockDocumentsReady(w) {
		return
	}
	var in sdi.AnswerDocumentEditRequestSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	v, err := h.Documents.AnswerDocumentEditRequest(r.Context(), editLockActor(r), chi.URLParam(r, "documentID"), chi.URLParam(r, "requestID"), service.AnswerDocumentEditRequestInput{
		Decision: strings.TrimSpace(in.Decision), LockID: strings.TrimSpace(in.LockID),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, documentEditRequestSDO(v))
}

// cancelDocumentEditRequest is R10 DELETE
// /documents/{documentID}/edit-requests/{requestID} (the requester): 204,
// idempotent.
func (h *handlers) cancelDocumentEditRequest(w http.ResponseWriter, r *http.Request) {
	if !h.editLockDocumentsReady(w) {
		return
	}
	if err := h.Documents.CancelDocumentEditRequest(r.Context(), editLockActor(r), chi.URLParam(r, "documentID"), chi.URLParam(r, "requestID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
