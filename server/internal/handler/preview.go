package handler

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) createPreviewScope(w http.ResponseWriter, r *http.Request) {
	if h.Preview == nil {
		respondError(w, http.StatusServiceUnavailable, "preview_unavailable", "preview is unavailable")
		return
	}
	var in sdi.CreatePreviewScopeSDI
	if !decode(w, r, &in, maxDocumentJSONBody) {
		return
	}
	in.JobID = strings.TrimSpace(in.JobID)
	if in.JobID == "" || len(in.Assets) > 256 {
		respondError(w, http.StatusBadRequest, "invalid_request", "job_id and at most 256 assets are required")
		return
	}
	ids := make([]string, len(in.Assets))
	seenKeys := make(map[string]struct{}, len(in.Assets))
	seenIDs := make(map[string]struct{}, len(in.Assets))
	for i, asset := range in.Assets {
		if !validPreviewManifestKey(asset.Key) || !validPreviewAssetID(asset.AssetID) {
			respondError(w, http.StatusBadRequest, "invalid_request", "preview assets must use canonical keys and opaque ids")
			return
		}
		if _, ok := seenKeys[asset.Key]; ok {
			respondError(w, http.StatusBadRequest, "invalid_request", "preview asset keys must be unique")
			return
		}
		if _, ok := seenIDs[asset.AssetID]; ok {
			respondError(w, http.StatusBadRequest, "invalid_request", "preview asset ids must be unique")
			return
		}
		seenKeys[asset.Key], seenIDs[asset.AssetID] = struct{}{}, struct{}{}
		ids[i] = asset.AssetID
	}
	scope, err := h.Preview.Mint(r.Context(), service.Human(middleware.UserID(r.Context())), service.PreviewScopeInput{
		DocumentID: chi.URLParam(r, "documentID"), JobID: in.JobID, AssetIDs: ids,
	})
	if err != nil {
		if errors.Is(err, service.ErrPreviewUnavailable) {
			respondError(w, http.StatusServiceUnavailable, "preview_unavailable", "preview is unavailable")
			return
		}
		h.mapServiceError(w, err)
		return
	}
	assets := make([]sdo.PreviewAssetDTO, len(scope.Assets))
	for i, asset := range scope.Assets {
		assets[i] = sdo.PreviewAssetDTO{Key: in.Assets[i].Key, AssetID: asset.AssetID, URL: asset.URL}
	}
	respondJSON(w, http.StatusCreated, sdo.PreviewScopeSDO{Origin: scope.Origin, ExpiresAt: scope.ExpiresAt.UTC().Format(time.RFC3339Nano), Assets: assets})
}

func (h *handlers) getPreviewAsset(w http.ResponseWriter, r *http.Request) {
	if h.Preview == nil {
		respondError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	rd, err := h.Preview.Open(r.Context(), chi.URLParam(r, "capability"), chi.URLParam(r, "assetID"))
	if err != nil {
		respondError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	defer func() { _ = rd.Close() }()
	header := w.Header()
	header.Set("Content-Type", rd.File.ContentType)
	header.Set("Content-Length", strconv.FormatInt(max64(rd.File.SizeBytes, 0), 10))
	header.Set("Content-Disposition", "inline")
	header.Set("Cache-Control", "no-store")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	header.Set("Referrer-Policy", "no-referrer")
	header.Set("Cross-Origin-Resource-Policy", "cross-origin")
	// The frame is credentialless and the capability is in the URL, so a
	// wildcard is safe here and lets fonts/stylesheets load from the preview
	// origin without exposing any app credentialed response.
	header.Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, rd.Body)
}

func validPreviewAssetID(value string) bool {
	if value == "" || len(value) > 128 || value == "." || value == ".." || strings.ContainsAny(value, "/\\?#%:") {
		return false
	}
	for _, r := range value {
		if r < 0x21 || r == 0x7f {
			return false
		}
	}
	return true
}

func validPreviewManifestKey(value string) bool {
	if value == "" || len(value) > 1024 || strings.Contains(value, "\\") || strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") || strings.Contains(value, ":") {
		return false
	}
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	for _, part := range strings.Split(value, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

func max64(value, minimum int64) int64 {
	if value < minimum {
		return minimum
	}
	return value
}
