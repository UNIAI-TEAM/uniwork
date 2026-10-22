package handler

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
)

// Documents of a document_changed notification (UNI-2056). The service reads
// the page and decides what the caller may see; the handler parses the query,
// guards the cursor and writes the wire shape.

// notificationDocumentsCursor pins the last document id the walk read, in this
// notification, for this caller. The id may name a document the caller cannot
// read (the walk skips it), so the token is sealed with the server secret and
// bound to both: it cannot be forged, moved to another notification or
// replayed by another account to learn where an unreadable document sits.
type notificationDocumentsCursor struct {
	ID           string `json:"id"`
	Notification string `json:"n"`
	User         string `json:"u"`
}

// notificationDocumentsCursorPrefix tags the sealed token format; a new format
// takes a new prefix.
const notificationDocumentsCursorPrefix = "ndc1."

// notificationDocumentsCursorMAC is the signature over the prefixed payload.
// The key is derived from the server secret under its own label, so this
// cursor can never pass for an access-report, change-feed or session token.
func notificationDocumentsCursorMAC(secret, body string) []byte {
	k := hmac.New(sha256.New, []byte(secret))
	k.Write([]byte("uniwork/notification-documents-cursor/v1"))
	m := hmac.New(sha256.New, k.Sum(nil))
	m.Write([]byte(body))
	return m.Sum(nil)
}

func encodeNotificationDocumentsCursor(secret string, c notificationDocumentsCursor) string {
	raw, _ := json.Marshal(c)
	body := notificationDocumentsCursorPrefix + base64.RawURLEncoding.EncodeToString(raw)
	return body + "." + base64.RawURLEncoding.EncodeToString(notificationDocumentsCursorMAC(secret, body))
}

// decodeNotificationDocumentsCursor reads a cursor and checks this server
// sealed it for this very notification and caller (ok=false otherwise, for a
// tampered, foreign, truncated or unsigned token alike).
func decodeNotificationDocumentsCursor(secret, raw string, want notificationDocumentsCursor) (string, bool) {
	rest, ok := strings.CutPrefix(raw, notificationDocumentsCursorPrefix)
	if !ok {
		return "", false
	}
	payload, sig, ok := strings.Cut(rest, ".")
	if !ok || payload == "" || sig == "" {
		return "", false
	}
	// Strict: one spelling per MAC.
	got, err := base64.RawURLEncoding.Strict().DecodeString(sig)
	if err != nil || !hmac.Equal(got, notificationDocumentsCursorMAC(secret, notificationDocumentsCursorPrefix+payload)) {
		return "", false
	}
	var c notificationDocumentsCursor
	dec, err := base64.RawURLEncoding.Strict().DecodeString(payload)
	if err != nil || json.Unmarshal(dec, &c) != nil || c.ID == "" {
		return "", false
	}
	if c.Notification != want.Notification || c.User != want.User {
		return "", false
	}
	return c.ID, true
}

// listNotificationDocuments is GET /me/notifications/{notificationID}/documents.
func (h *handlers) listNotificationDocuments(w http.ResponseWriter, r *http.Request) {
	scope := notificationDocumentsCursor{Notification: chi.URLParam(r, "notificationID"), User: middleware.UserID(r.Context())}
	qs := r.URL.Query()
	var limit int32
	if raw := strings.TrimSpace(qs.Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			respondError(w, http.StatusBadRequest, "invalid_request", "limit must be a non-negative integer")
			return
		}
		limit = int32(min(n, 1000))
	}
	after := ""
	if raw := strings.TrimSpace(qs.Get("cursor")); raw != "" {
		id, ok := decodeNotificationDocumentsCursor(h.Cfg.JWTSecret, raw, scope)
		if !ok {
			respondError(w, http.StatusBadRequest, "invalid_request", "cursor không hợp lệ")
			return
		}
		after = id
	}
	page, err := h.Notifications.Documents(r.Context(), scope.User, scope.Notification, after, limit)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.NotificationDocumentsSDO{Documents: make([]sdo.NotificationDocumentDTO, 0, len(page.Rows))}
	for _, row := range page.Rows {
		out.Documents = append(out.Documents, sdo.NotificationDocumentDTO{
			ID: row.ID, Title: row.Title, Kind: row.Kind, Trashed: row.Trashed, Shelved: row.Shelved, Deleted: row.Deleted,
		})
	}
	if page.More && page.Next != "" {
		cursor := encodeNotificationDocumentsCursor(h.Cfg.JWTSecret, notificationDocumentsCursor{ID: page.Next, Notification: scope.Notification, User: scope.User})
		out.NextCursor = &cursor
	}
	respondJSON(w, http.StatusOK, out)
}
