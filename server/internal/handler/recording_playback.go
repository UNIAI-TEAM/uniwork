package handler

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/unicomhub/uniwork/server/internal/storage"
)

const recordingPlaybackTTL = 15 * time.Minute

func presignRecordingPlaybackURL(
	ctx context.Context,
	presigner storage.DownloadPresigner,
	key string,
) (playbackURL string, expiresAt time.Time, err error) {
	expiresAt = time.Now().UTC().Add(recordingPlaybackTTL)
	playbackURL, err = presigner.PresignGetWithContentDisposition(
		ctx, key, recordingPlaybackTTL, "inline",
	)
	return playbackURL, expiresAt, err
}

// streamRecordingObject serves an MP4 from storage with optional byte-range support.
func (h *handlers) streamRecordingObject(w http.ResponseWriter, r *http.Request, key, recordingID string) {
	if h.Storage == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "file storage is not configured")
		return
	}
	s3Store, ok := h.Storage.(*storage.S3Storage)
	if !ok {
		h.streamRecordingObjectFull(w, r, key, recordingID)
		return
	}
	size, err := s3Store.ObjectSize(r.Context(), key)
	if err != nil {
		h.Log.Error("recording head", "err", err, "recording_id", recordingID)
		respondError(w, http.StatusNotFound, "not_found", "recording file not found")
		return
	}
	start, end, ok := parseByteRange(r.Header.Get("Range"), size)
	if !ok {
		respondError(w, http.StatusRequestedRangeNotSatisfiable, "invalid_range", "invalid byte range")
		return
	}
	reader, err := s3Store.GetReaderRange(r.Context(), key, start, end)
	if err != nil {
		h.Log.Error("recording read", "err", err, "recording_id", recordingID)
		respondError(w, http.StatusNotFound, "not_found", "recording file not found")
		return
	}
	defer reader.Close()

	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Header.Get("Range") != "" {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, size))
		w.Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
		w.WriteHeader(http.StatusPartialContent)
	} else {
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	}
	if _, err := io.Copy(w, reader); err != nil {
		h.Log.Error("recording stream", "err", err, "recording_id", recordingID)
	}
}

func (h *handlers) streamRecordingObjectFull(w http.ResponseWriter, r *http.Request, key, recordingID string) {
	reader, err := h.Storage.GetReader(r.Context(), key)
	if err != nil {
		h.Log.Error("recording read", "err", err, "recording_id", recordingID)
		respondError(w, http.StatusNotFound, "not_found", "recording file not found")
		return
	}
	defer reader.Close()

	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if _, err := io.Copy(w, reader); err != nil {
		h.Log.Error("recording stream", "err", err, "recording_id", recordingID)
	}
}

// parseByteRange interprets a single HTTP Range header against object size.
// Returns ok=false for malformed or unsatisfiable ranges.
func parseByteRange(rangeHeader string, size int64) (start, end int64, ok bool) {
	if size <= 0 {
		return 0, 0, false
	}
	rangeHeader = strings.TrimSpace(rangeHeader)
	if rangeHeader == "" {
		return 0, size - 1, true
	}
	if !strings.HasPrefix(rangeHeader, "bytes=") {
		return 0, 0, false
	}
	spec := strings.TrimSpace(strings.TrimPrefix(rangeHeader, "bytes="))
	if spec == "" || strings.Contains(spec, ",") {
		return 0, 0, false
	}
	parts := strings.SplitN(spec, "-", 2)
	if len(parts) != 2 {
		return 0, 0, false
	}
	left := strings.TrimSpace(parts[0])
	right := strings.TrimSpace(parts[1])
	switch {
	case left == "" && right != "":
		suffix, err := strconv.ParseInt(right, 10, 64)
		if err != nil || suffix <= 0 {
			return 0, 0, false
		}
		if suffix >= size {
			return 0, size - 1, true
		}
		return size - suffix, size - 1, true
	case left != "" && right == "":
		start, err := strconv.ParseInt(left, 10, 64)
		if err != nil || start < 0 || start >= size {
			return 0, 0, false
		}
		return start, size - 1, true
	case left != "" && right != "":
		start, err1 := strconv.ParseInt(left, 10, 64)
		end, err2 := strconv.ParseInt(right, 10, 64)
		if err1 != nil || err2 != nil || start < 0 || end < start || start >= size {
			return 0, 0, false
		}
		if end >= size {
			end = size - 1
		}
		return start, end, true
	default:
		return 0, 0, false
	}
}
