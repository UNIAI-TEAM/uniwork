package handler

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"

	"github.com/oklog/ulid/v2"

	"github.com/unicomhub/uniwork/server/internal/middleware"
)

// maxAvatarBytes bounds the decoded image, not the multipart envelope; the
// reader below is given a little headroom for the multipart framing.
const maxAvatarBytes = 2 << 20

// Only the sniffed type decides. The multipart part carries a Content-Type
// the client chose, and a filename extension it also chose; neither is
// evidence of what the bytes are.
var avatarExtByType = map[string]string{
	"image/png":  "png",
	"image/jpeg": "jpg",
	"image/gif":  "gif",
	"image/webp": "webp",
}

// POST /api/v1/me/avatar — multipart field "file".
//
// The first real consumer of the storage layer: the key is written under the
// user's own prefix, the object goes to storage first, and only then is the
// URL persisted, so a row never points at bytes that do not exist.
func (h *handlers) uploadAvatar(w http.ResponseWriter, r *http.Request) {
	if h.Storage == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "file storage is not configured")
		return
	}
	userID := middleware.UserID(r.Context())

	r.Body = http.MaxBytesReader(w, r.Body, maxAvatarBytes+64<<10)
	file, _, err := r.FormFile("file")
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			respondError(w, http.StatusRequestEntityTooLarge, "too_large", fmt.Sprintf("avatar must be at most %d bytes", maxAvatarBytes))
			return
		}
		respondError(w, http.StatusBadRequest, "invalid_request", `multipart field "file" is required`)
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxAvatarBytes+1))
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "could not read upload")
		return
	}
	if len(data) > maxAvatarBytes {
		respondError(w, http.StatusRequestEntityTooLarge, "too_large", fmt.Sprintf("avatar must be at most %d bytes", maxAvatarBytes))
		return
	}

	contentType := http.DetectContentType(data)
	ext, ok := avatarExtByType[contentType]
	if !ok {
		respondError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "avatar must be a PNG, JPEG, GIF or WebP image")
		return
	}

	key := path.Join("avatars", userID, strings.ToLower(ulid.Make().String())+"."+ext)
	url, err := h.Storage.Upload(r.Context(), key, data, contentType, "avatar."+ext)
	if err != nil {
		h.Log.Error("avatar upload", "err", err, "user_id", userID)
		respondError(w, http.StatusInternalServerError, "internal", "could not store avatar")
		return
	}

	u, err := h.Auth.UpdateAvatar(r.Context(), userID, url)
	if err != nil {
		// The object is orphaned; storage cleanup is best-effort and must not
		// turn a failed row update into a second failure for the client.
		h.Storage.Delete(r.Context(), key)
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"user": toUserDTO(u)})
}
