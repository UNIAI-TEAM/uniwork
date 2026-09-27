package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Documents HTTP (C-01 §5 + §14; UNI-679, G1-05a). Every handler builds the
// actor with service.Human from the auth middleware, never trusts an
// organization or workspace id from a body, never queries the DB, and hands
// the wire shape straight to DocumentService. Multipart routes stream the
// file part into FileService under their own request cap; JSON routes use a
// cap matched to the service contract, not the generic 1 MiB maxJSONBody:
// document.DefaultLimits() accepts raw page input to 8 MiB (sanitized output
// is the 2 MiB the spec quotes), so the transport cap is that raw bound plus
// envelope overhead — a request the service would accept is never cut here.
const (
	maxDocumentJSONBody       = 8<<20 + 64<<10
	documentFileMultipartCap  = 50<<20 + 256<<10
	documentAssetMultipartCap = 10<<20 + 256<<10
)

var errDocumentUploadTooLarge = errors.New("documents: upload exceeds the request cap")

func documentTooLarge(w http.ResponseWriter) {
	respondError(w, http.StatusRequestEntityTooLarge, "file_too_large", "tệp vượt quá dung lượng cho phép")
}

// cappedDocumentPart counts part bytes while they stream into a service call
// so an over-limit upload answers 413 even when the failure arrives wrapped.
type cappedDocumentPart struct {
	r   io.Reader
	max int64
	n   int64
}

func (c *cappedDocumentPart) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	if c.n > c.max && err == nil {
		err = errDocumentUploadTooLarge
	}
	return n, err
}

// documentUploadFieldCap bounds one text part of a document upload; a field
// past it is rejected rather than truncated into a misleading title.
const documentUploadFieldCap = 4 << 10

// documentUploadForm streams the required "file" part into the caller's
// service call - unlike r.FormFile, which buffers the whole part to memory or
// a temp file before returning, MultipartReader hands the live part stream
// over and the service reads it as it arrives. A request whose Content-Length
// already exceeds the cap is refused without reading the body; MaxBytesReader
// still bounds a chunked one. Text fields are honoured only while they
// precede the file part (the wire contract orders them first); anything after
// is dropped when the body drains. The caller owns the returned part's Close.
func documentUploadForm(w http.ResponseWriter, r *http.Request, cap int64) (*multipart.Part, map[string]string, bool) {
	if r.ContentLength > cap {
		documentTooLarge(w)
		return nil, nil, false
	}
	r.Body = http.MaxBytesReader(w, r.Body, cap)
	mr, err := r.MultipartReader()
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "multipart/form-data body required")
		return nil, nil, false
	}
	fields := map[string]string{}
	for {
		p, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				documentTooLarge(w)
			} else {
				respondError(w, http.StatusBadRequest, "invalid_request", "malformed multipart body")
			}
			return nil, nil, false
		}
		if p.FormName() != "file" {
			b, err := io.ReadAll(io.LimitReader(p, documentUploadFieldCap+1))
			_ = p.Close()
			if err != nil || len(b) > documentUploadFieldCap {
				respondError(w, http.StatusBadRequest, "invalid_request", "multipart field "+p.FormName()+" is too large")
				return nil, nil, false
			}
			fields[p.FormName()] = string(b)
			continue
		}
		if p.FileName() == "" {
			_ = p.Close()
			respondError(w, http.StatusBadRequest, "invalid_request", `multipart field "file" must carry a filename`)
			return nil, nil, false
		}
		return p, fields, true
	}
	respondError(w, http.StatusBadRequest, "invalid_request", `multipart field "file" is required`)
	return nil, nil, false
}

// mapDocumentUploadError answers a streamed-upload failure: a read that hit
// the request cap (ours or the MaxBytesReader on the body) is 413, anything
// else goes through the service error table.
func (h *handlers) mapDocumentUploadError(w http.ResponseWriter, part *cappedDocumentPart, err error) {
	var tooBig *http.MaxBytesError
	if part.n > part.max || errors.Is(err, errDocumentUploadTooLarge) || errors.As(err, &tooBig) {
		documentTooLarge(w)
		return
	}
	h.mapServiceError(w, err)
}

// createDocument is POST /workspaces/{workspaceID}/documents: a page. The
// body carries content under the 2 MiB+envelope cap; kind must be "page" (a
// file document is created on the multipart route). Idempotency-Key binds
// the create to its payload fingerprint.
func (h *handlers) createDocument(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.CreateDocumentSDI
	if !decode(w, r, &in, maxDocumentJSONBody) {
		return
	}
	if in.Kind != "" && in.Kind != service.DocumentKindPage {
		respondError(w, http.StatusBadRequest, "invalid_request", "kind must be page; use the multipart route for file documents")
		return
	}
	var content json.RawMessage
	if in.Content != nil {
		content = *in.Content
	}
	view, err := h.Documents.CreatePage(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"), service.CreatePageInput{
		ParentID:       stringValue(in.ParentID),
		Title:          in.Title,
		Icon:           stringValue(in.Icon),
		Visibility:     in.Visibility,
		Content:        content,
		IdempotencyKey: r.Header.Get("Idempotency-Key"),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, sdo.DocumentSDO{Document: documentDTO(view)})
}

// getDocument is GET /documents/{documentID}: the working copy for a page or
// the descriptor for a file document, with the caller's level and crumbs.
func (h *handlers) getDocument(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	view, err := h.Documents.GetDocument(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DocumentSDO{Document: documentDTO(view)})
}

// patchDocument is PATCH /documents/{documentID}: the autosave/metadata write
// path. revision is required; a stale base answers 422 revision_conflict.
func (h *handlers) patchDocument(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.PatchDocumentSDI
	if !decode(w, r, &in, maxDocumentJSONBody) {
		return
	}
	revision, err := strconv.ParseInt(strings.TrimSpace(in.Revision), 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "revision must be a decimal string")
		return
	}
	var content json.RawMessage
	if in.Content != nil {
		content = *in.Content
	}
	view, err := h.Documents.UpdateDocument(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"), service.UpdateDocumentInput{
		Revision:   revision,
		Title:      in.Title,
		Icon:       in.Icon,
		Visibility: in.Visibility,
		Content:    content,
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DocumentSDO{Document: documentDTO(view)})
}

// createDocumentFile is POST /workspaces/{workspaceID}/documents/files: one
// multipart file document. The file part streams into FileService; parent_id
// and title are optional form fields.
func (h *handlers) createDocumentFile(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	file, fields, ok := documentUploadForm(w, r, documentFileMultipartCap)
	if !ok {
		return
	}
	defer file.Close()
	part := &cappedDocumentPart{r: file, max: 50 << 20}
	res, err := h.Documents.CreateFileDocument(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"), service.CreateFileDocumentInput{
		ParentID:       strings.TrimSpace(fields["parent_id"]),
		Title:          strings.TrimSpace(fields["title"]),
		Filename:       file.FileName(),
		Body:           part,
		IdempotencyKey: r.Header.Get("Idempotency-Key"),
	})
	if err != nil {
		h.mapDocumentUploadError(w, part, err)
		return
	}
	// The result carries the document and its first version; the SDO's crumbs
	// come from a fresh read so a file created under a parent shows its path.
	view, err := h.Documents.GetDocument(r.Context(), service.Human(middleware.UserID(r.Context())), res.Document.ID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, sdo.DocumentSDO{Document: documentDTO(view)})
}

// uploadDocumentFile is POST /documents/{documentID}/uploads: stage the bytes
// of a candidate file version (upload_id = file_id) for a later commit.
func (h *handlers) uploadDocumentFile(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	file, _, ok := documentUploadForm(w, r, documentFileMultipartCap)
	if !ok {
		return
	}
	defer file.Close()
	part := &cappedDocumentPart{r: file, max: 50 << 20}
	up, err := h.Documents.UploadDocumentFile(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"), service.DocumentUploadInput{
		Filename:       file.FileName(),
		Body:           part,
		IdempotencyKey: r.Header.Get("Idempotency-Key"),
	})
	if err != nil {
		h.mapDocumentUploadError(w, part, err)
		return
	}
	respondJSON(w, http.StatusCreated, sdo.DocumentUploadSDO{
		UploadID:       up.UploadID,
		ChecksumSha256: up.ChecksumSHA256,
		SizeBytes:      up.SizeBytes,
		ClaimExpiresAt: up.ClaimExpiresAt.UTC().Format(time.RFC3339),
	})
}

// commitDocumentVersion is POST /documents/{documentID}/versions/commit: the
// one save shape for a file document (C-01 §14). upload_id names the staged
// bytes, base_revision the revision the writer saw; Idempotency-Key binds the
// pair so a retry replays the stored answer.
func (h *handlers) commitDocumentVersion(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.CommitDocumentVersionSDI
	if !decode(w, r, &in, maxDocumentJSONBody) {
		return
	}
	base, err := strconv.ParseInt(strings.TrimSpace(in.BaseRevision), 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "base_revision must be a decimal string")
		return
	}
	res, err := h.Documents.CommitFileVersion(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"), service.CommitFileVersionInput{
		UploadID:       strings.TrimSpace(in.UploadID),
		BaseRevision:   base,
		IdempotencyKey: r.Header.Get("Idempotency-Key"),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, documentVersionResultSDO(res.Document, res.Access, res.File, res.Version))
}

// listDocumentVersions is GET /documents/{documentID}/versions?cursor&limit.
func (h *handlers) listDocumentVersions(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	q := r.URL.Query()
	limit := 0
	if raw := strings.TrimSpace(q.Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			respondError(w, http.StatusBadRequest, "invalid_request", "limit must be a non-negative integer")
			return
		}
		limit = n
	}
	page, err := h.Documents.ListDocumentVersions(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"), service.ListDocumentVersionsInput{
		Cursor: strings.TrimSpace(q.Get("cursor")),
		Limit:  limit,
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.DocumentVersionListSDO{Versions: make([]sdo.DocumentVersionDTO, 0, len(page.Versions))}
	for _, v := range page.Versions {
		out.Versions = append(out.Versions, documentVersionDTO(v, false))
	}
	if page.NextCursor != "" {
		out.NextCursor = &page.NextCursor
	}
	respondJSON(w, http.StatusOK, out)
}

// getDocumentVersion is GET /documents/{documentID}/versions/{versionNo}: one
// version, page versions carrying their content.
func (h *handlers) getDocumentVersion(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	versionNo, ok := documentVersionNo(w, r)
	if !ok {
		return
	}
	v, err := h.Documents.GetDocumentVersion(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"), versionNo)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DocumentVersionSDO{Version: documentVersionDTO(v, true)})
}

// createDocumentVersion is POST /documents/{documentID}/versions: a named
// manual checkpoint of a page's working copy.
func (h *handlers) createDocumentVersion(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.CreateDocumentVersionSDI
	if !decode(w, r, &in, maxDocumentJSONBody) {
		return
	}
	label := ""
	if in.Label != nil {
		label = *in.Label
	}
	v, err := h.Documents.CreateDocumentVersion(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"), service.CreateDocumentVersionInput{
		Label:          label,
		IdempotencyKey: r.Header.Get("Idempotency-Key"),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, sdo.DocumentVersionSDO{Version: documentVersionDTO(v, false)})
}

// restoreDocumentVersion appends a restore version pointing at an earlier
// version and updates the working copy. The contract declares no request
// body: a page restore carries nothing and restores over whatever the working
// copy holds. A file restore must still name the base revision the writer saw
// (document_commit.go checks it unconditionally), so the optional
// RestoreDocumentVersionSDI body carries it.
func (h *handlers) restoreDocumentVersion(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	versionNo, ok := documentVersionNo(w, r)
	if !ok {
		return
	}
	var body sdi.RestoreDocumentVersionSDI
	if r.Body != nil && r.ContentLength != 0 {
		if !decode(w, r, &body, maxJSONBody) {
			return
		}
	}
	var base int64
	if body.BaseRevision != nil {
		n, err := strconv.ParseInt(strings.TrimSpace(*body.BaseRevision), 10, 64)
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid_request", "base_revision must be a decimal string")
			return
		}
		base = n
	}
	res, err := h.Documents.RestoreDocumentVersion(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"), service.RestoreDocumentVersionInput{
		Version:        versionNo,
		BaseRevision:   base,
		IdempotencyKey: r.Header.Get("Idempotency-Key"),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DocumentVersionResultSDO{
		Document: documentDTO(res.View),
		Version:  documentVersionDTO(res.Version, false),
	})
}

// uploadDocumentAsset is POST /documents/{documentID}/assets: an image a page
// embeds via asset://{id}. The file part streams into FileService under the
// document_asset policy (10 MiB, image allowlist).
func (h *handlers) uploadDocumentAsset(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	file, _, ok := documentUploadForm(w, r, documentAssetMultipartCap)
	if !ok {
		return
	}
	defer file.Close()
	part := &cappedDocumentPart{r: file, max: 10 << 20}
	asset, err := h.Documents.UploadDocumentAsset(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"), service.DocumentUploadInput{
		Filename:       file.FileName(),
		Body:           part,
		IdempotencyKey: r.Header.Get("Idempotency-Key"),
	})
	if err != nil {
		h.mapDocumentUploadError(w, part, err)
		return
	}
	out := sdo.DocumentAssetSDO{
		ID:         asset.ID,
		DocumentID: asset.DocumentID,
		URL:        "/api/v1/documents/" + asset.DocumentID + "/assets/" + asset.ID,
		MimeType:   asset.MimeType,
		SizeBytes:  asset.SizeBytes,
	}
	if asset.Width.Valid {
		out.Width = &asset.Width.Int32
	}
	if asset.Height.Valid {
		out.Height = &asset.Height.Int32
	}
	if asset.CreatedAt.Valid {
		out.CreatedAt = asset.CreatedAt.Time.UTC().Format(time.RFC3339)
	}
	respondJSON(w, http.StatusCreated, out)
}

// getDocumentAsset is GET|HEAD /documents/{documentID}/assets/{assetID}: the
// authenticated proxy route a page's asset:// reference resolves to. Images
// on the allowlist go inline; anything else downloads.
func (h *handlers) getDocumentAsset(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	rd, rng, ranged, err := h.openDocumentAssetRange(w, r)
	if err != nil || rd == nil {
		return
	}
	defer rd.Close()
	h.serveDocumentFile(w, r, documentFilePayload{
		Body:        rd.Body,
		SizeBytes:   rd.File.SizeBytes,
		ContentType: rd.File.ContentType,
		Filename:    rd.File.Filename,
		Disposition: storage.ContentDisposition(rd.File.ContentType, rd.File.Filename),
		Checksum:    rd.File.ChecksumSHA256,
	}, rng, ranged)
}

// downloadDocument is GET|HEAD /documents/{documentID}/download: meta=1
// answers the DocumentDownloadSDO descriptor; otherwise the route streams the
// bytes of the live (or named) file version with Range/HEAD support. Always
// attachment - a document file is user content the browser must not open in
// our origin.
func (h *handlers) downloadDocument(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	q := r.URL.Query()
	var versionNo int32
	if raw := strings.TrimSpace(q.Get("version")); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 32)
		if err != nil || n <= 0 {
			respondError(w, http.StatusBadRequest, "invalid_request", "version must be a positive integer")
			return
		}
		versionNo = int32(n)
	}
	meta := false
	if raw := strings.TrimSpace(q.Get("meta")); raw != "" {
		b, err := strconv.ParseBool(raw)
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid_request", "meta must be 1/true or 0/false")
			return
		}
		meta = b
	}
	actor := service.Human(middleware.UserID(r.Context()))
	documentID := chi.URLParam(r, "documentID")
	f, rng, ranged, err := h.openDocumentFileRange(w, r, actor, documentID, versionNo)
	if err != nil || f == nil {
		return
	}
	defer f.Reader.Close()
	if meta {
		respondJSON(w, http.StatusOK, sdo.DocumentDownloadSDO{
			DocumentID:  documentID,
			File:        documentFileDTO(documentFileInfoOf(f)),
			Disposition: "attachment",
		})
		return
	}
	payload := documentFilePayload{
		Body:        f.Reader.Body,
		SizeBytes:   f.Reader.File.SizeBytes,
		ContentType: f.Reader.File.ContentType,
		Filename:    f.Reader.File.Filename,
		Disposition: storage.AttachmentContentDisposition(f.Reader.File.Filename),
	}
	if f.Version.ChecksumSha256.Valid {
		payload.Checksum = f.Version.ChecksumSha256.String
	}
	h.serveDocumentFile(w, r, payload, rng, ranged)
}

// documentRangeSpec is the client's Range header translated to the service's
// absolute window. suffix carries "bytes=-N": the service cannot express a
// tail without the size, so the caller opens a 1-byte probe first.
type documentRangeSpec struct {
	offset int64
	length int64
	suffix int64
	has    bool
}

// parseDocumentRange validates the Range header syntactically; the size check
// happens after open, when the file record is known. A malformed or
// unsupported header (bad unit, multi-range, nonsense bounds) is ignored per
// RFC 9110 §14.2 and the whole body is served - a ranged client must never
// get an error where a plain GET would have streamed the file.
func parseDocumentRange(r *http.Request) documentRangeSpec {
	var spec documentRangeSpec
	raw := strings.TrimSpace(r.Header.Get("Range"))
	if raw == "" {
		return spec
	}
	bad := func() documentRangeSpec { return documentRangeSpec{} }
	if !strings.HasPrefix(raw, "bytes=") || strings.Contains(raw, ",") {
		return bad()
	}
	parts := strings.SplitN(strings.TrimSpace(strings.TrimPrefix(raw, "bytes=")), "-", 2)
	if len(parts) != 2 {
		return bad()
	}
	left, right := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
	switch {
	case left == "" && right != "":
		n, err := strconv.ParseInt(right, 10, 64)
		if err != nil || n <= 0 {
			return bad()
		}
		spec.suffix = n
	case left != "":
		start, err := strconv.ParseInt(left, 10, 64)
		if err != nil || start < 0 {
			return bad()
		}
		spec.offset = start
		if right != "" {
			end, err := strconv.ParseInt(right, 10, 64)
			if err != nil || end < start {
				return bad()
			}
			spec.length = end - start + 1
		}
	default:
		return bad()
	}
	spec.has = true
	return spec
}

// openDocumentFileRange resolves the Range header into the service window and
// opens the document's bytes once (a suffix range costs a 1-byte probe to
// learn the size first). A malformed header is ignored and the body opens
// whole; a window past the end is answered 416 by serveDocumentFile once it
// sees the size. Returns the effective window and whether a range applied so
// the response headers match the opened body.
func (h *handlers) openDocumentFileRange(w http.ResponseWriter, r *http.Request, actor service.Actor, documentID string, versionNo int32) (*service.DocumentFile, service.DocumentByteRange, bool, error) {
	spec := parseDocumentRange(r)
	rng := service.DocumentByteRange{Offset: spec.offset, Length: spec.length}
	if spec.suffix > 0 {
		probe, err := h.Documents.OpenDocumentFile(r.Context(), actor, documentID, versionNo, service.DocumentByteRange{Length: 1})
		if err != nil {
			h.mapServiceError(w, err)
			return nil, service.DocumentByteRange{}, false, err
		}
		size := probe.Reader.File.SizeBytes
		_ = probe.Reader.Close()
		if spec.suffix >= size {
			rng = service.DocumentByteRange{}
		} else {
			rng = service.DocumentByteRange{Offset: size - spec.suffix, Length: spec.suffix}
		}
	}
	f, err := h.Documents.OpenDocumentFile(r.Context(), actor, documentID, versionNo, rng)
	if err != nil {
		h.mapServiceError(w, err)
		return nil, service.DocumentByteRange{}, false, err
	}
	return &f, rng, spec.has, nil
}

// openDocumentAssetRange is openDocumentFileRange for the asset route: same
// window math on OpenDocumentAsset.
func (h *handlers) openDocumentAssetRange(w http.ResponseWriter, r *http.Request) (*files.Reader, service.DocumentByteRange, bool, error) {
	spec := parseDocumentRange(r)
	actor := service.Human(middleware.UserID(r.Context()))
	rng := service.DocumentByteRange{Offset: spec.offset, Length: spec.length}
	if spec.suffix > 0 {
		probe, err := h.Documents.OpenDocumentAsset(r.Context(), actor, chi.URLParam(r, "documentID"), chi.URLParam(r, "assetID"), service.DocumentByteRange{Length: 1})
		if err != nil {
			h.mapServiceError(w, err)
			return nil, service.DocumentByteRange{}, false, err
		}
		size := probe.File.SizeBytes
		_ = probe.Close()
		if spec.suffix >= size {
			rng = service.DocumentByteRange{}
		} else {
			rng = service.DocumentByteRange{Offset: size - spec.suffix, Length: spec.suffix}
		}
	}
	rd, err := h.Documents.OpenDocumentAsset(r.Context(), actor, chi.URLParam(r, "documentID"), chi.URLParam(r, "assetID"), rng)
	if err != nil {
		h.mapServiceError(w, err)
		return nil, service.DocumentByteRange{}, false, err
	}
	return &rd, rng, spec.has, nil
}

// documentFilePayload is the opened object plus the headers a document byte
// route serves.
type documentFilePayload struct {
	Body        io.Reader
	SizeBytes   int64
	ContentType string
	Filename    string
	Disposition string
	Checksum    string
}

// serveDocumentFile writes the shared byte-route response: attachment or
// safe-inline disposition, no-store caching, nosniff and the sandbox CSP that
// keeps user bytes from ever running script in our origin. rng is the window
// the body was opened at; Length 0 means "to the end". A satisfiable Range
// answers 206 with Content-Range, an unsatisfiable one 416.
func (h *handlers) serveDocumentFile(w http.ResponseWriter, r *http.Request, p documentFilePayload, rng service.DocumentByteRange, ranged bool) {
	header := w.Header()
	header.Set("Content-Type", p.ContentType)
	header.Set("Content-Disposition", p.Disposition)
	header.Set("Accept-Ranges", "bytes")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Cache-Control", "private, no-store")
	header.Set("Content-Security-Policy", "sandbox; default-src 'none'")
	if p.Checksum != "" {
		header.Set("X-Checksum-Sha256", p.Checksum)
	}
	if ranged && (rng.Offset >= p.SizeBytes || p.SizeBytes == 0) {
		header.Set("Content-Range", "bytes */"+strconv.FormatInt(p.SizeBytes, 10))
		respondError(w, http.StatusRequestedRangeNotSatisfiable, "invalid_request", "requested range is not satisfiable")
		return
	}
	served := p.SizeBytes - rng.Offset
	if rng.Length > 0 && rng.Length < served {
		served = rng.Length
	}
	if served < 0 {
		served = 0
	}
	header.Set("Content-Length", strconv.FormatInt(served, 10))
	if ranged {
		header.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", rng.Offset, rng.Offset+served-1, p.SizeBytes))
		w.WriteHeader(http.StatusPartialContent)
	} else {
		w.WriteHeader(http.StatusOK)
	}
	if r.Method == http.MethodHead {
		return
	}
	if _, err := io.Copy(w, p.Body); err != nil && r.Context().Err() == nil {
		h.Log.Error("document byte stream", "err", err)
	}
}

func documentVersionNo(w http.ResponseWriter, r *http.Request) (int32, bool) {
	n, err := strconv.ParseInt(chi.URLParam(r, "versionNo"), 10, 32)
	if err != nil || n <= 0 {
		respondError(w, http.StatusNotFound, "not_found", "not found")
		return 0, false
	}
	return int32(n), true
}

func stringValue(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// documentFileInfoOf is the DocumentFileInfo of a streamed file: the version
// row's identity plus the FileService record's verified facts (stored
// filename, verified content type, measured size, checksum).
func documentFileInfoOf(f *service.DocumentFile) service.DocumentFileInfo {
	info := service.DocumentFileInfo{
		FileID:         string(f.Reader.File.ID),
		VersionID:      f.Version.ID,
		Version:        f.Version.Version,
		Filename:       f.Reader.File.Filename,
		MimeType:       f.Reader.File.ContentType,
		SizeBytes:      f.Reader.File.SizeBytes,
		ChecksumSHA256: f.Reader.File.ChecksumSHA256,
	}
	if f.Version.FileID.Valid {
		info.FileID = f.Version.FileID.String
	}
	if info.ChecksumSHA256 == "" && f.Version.ChecksumSha256.Valid {
		info.ChecksumSHA256 = f.Version.ChecksumSha256.String
	}
	return info
}

func documentFileDTO(f service.DocumentFileInfo) sdo.DocumentFileDTO {
	return sdo.DocumentFileDTO{
		FileID:         f.FileID,
		VersionID:      f.VersionID,
		Version:        f.Version,
		Filename:       f.Filename,
		MimeType:       f.MimeType,
		SizeBytes:      f.SizeBytes,
		ChecksumSha256: f.ChecksumSHA256,
	}
}

// documentDTO renders DocumentSDO.document from a service view. content is
// the sanitized working copy and only ever rides on a page; file is the
// current file version's block.
func documentDTO(view service.DocumentView) sdo.DocumentDTO {
	doc := view.Document
	out := sdo.DocumentDTO{
		ID:             doc.ID,
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		Kind:           doc.Kind,
		Title:          doc.Title,
		Visibility:     doc.Visibility,
		Revision:       strconv.FormatInt(doc.Revision, 10),
		CurrentVersion: doc.CurrentVersion,
		Position:       doc.Position,
		MyLevel:        string(view.Access.Level),
		Via:            string(view.Access.Via),
		CreatedBy:      doc.CreatedBy,
		CreatedByKind:  doc.CreatedByKind,
		UpdatedBy:      doc.UpdatedBy,
		UpdatedByKind:  doc.UpdatedByKind,
	}
	if doc.ParentID.Valid {
		out.ParentID = &doc.ParentID.String
	}
	if doc.Icon.Valid && doc.Icon.String != "" {
		out.Icon = &doc.Icon.String
	}
	if doc.Kind == service.DocumentKindPage && len(doc.Content) > 0 {
		raw := json.RawMessage(doc.Content)
		out.Content = &raw
	}
	if doc.ContentText != "" {
		out.ContentText = doc.ContentText
	}
	if len(view.Breadcrumbs) > 0 {
		out.Breadcrumbs = make([]sdo.DocumentBreadcrumbDTO, 0, len(view.Breadcrumbs))
		for _, c := range view.Breadcrumbs {
			cr := sdo.DocumentBreadcrumbDTO{ID: c.ID, Title: c.Title}
			if c.Icon != "" {
				icon := c.Icon
				cr.Icon = &icon
			}
			out.Breadcrumbs = append(out.Breadcrumbs, cr)
		}
	}
	if view.File != nil {
		f := documentFileDTO(*view.File)
		out.File = &f
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
	if doc.CreatedAt.Valid {
		out.CreatedAt = doc.CreatedAt.Time.UTC().Format(time.RFC3339)
	}
	if doc.UpdatedAt.Valid {
		out.UpdatedAt = doc.UpdatedAt.Time.UTC().Format(time.RFC3339)
	}
	return out
}

// documentResultDTO renders the document block of a file command's result
// (commit): same fields as documentDTO minus the breadcrumbs the result does
// not carry.
func documentResultDTO(doc db.Document, access service.DocumentAccess, file service.DocumentFileInfo) sdo.DocumentDTO {
	return documentDTO(service.DocumentView{Document: doc, Access: access, File: &file})
}

// documentVersionDTO renders DocumentVersionDTO. withContent is set only on
// the single-version GET of a page version; a file version instead carries
// file_id, the stored snapshot and the proxy download_url.
func documentVersionDTO(v db.DocumentVersion, withContent bool) sdo.DocumentVersionDTO {
	out := sdo.DocumentVersionDTO{
		ID:            v.ID,
		DocumentID:    v.DocumentID,
		Version:       v.Version,
		Kind:          v.Kind,
		Reason:        v.Reason,
		SizeBytes:     v.SizeBytes,
		CreatedBy:     v.CreatedBy,
		CreatedByKind: v.CreatedByKind,
	}
	if v.Label.Valid && v.Label.String != "" {
		out.Label = &v.Label.String
	}
	if withContent && len(v.Content) > 0 {
		raw := json.RawMessage(v.Content)
		out.Content = &raw
	}
	if v.FileID.Valid {
		out.FileID = &v.FileID.String
		url := "/api/v1/documents/" + v.DocumentID + "/download?version=" + strconv.Itoa(int(v.Version))
		out.DownloadURL = &url
	}
	if v.MimeType.Valid {
		out.MimeType = &v.MimeType.String
	}
	if v.ChecksumSha256.Valid && v.ChecksumSha256.String != "" {
		out.ChecksumSha256 = &v.ChecksumSha256.String
	}
	if v.RestoredFrom.Valid {
		out.RestoredFrom = &v.RestoredFrom.Int32
	}
	if v.EngineName.Valid && v.EngineName.String != "" {
		out.EngineName = &v.EngineName.String
	}
	if v.EngineVersion.Valid && v.EngineVersion.String != "" {
		out.EngineVersion = &v.EngineVersion.String
	}
	if v.ContractVersion.Valid && v.ContractVersion.String != "" {
		out.ContractVersion = &v.ContractVersion.String
	}
	if v.ProtocolVersion.Valid && v.ProtocolVersion.String != "" {
		out.ProtocolVersion = &v.ProtocolVersion.String
	}
	if v.CreatedAt.Valid {
		out.CreatedAt = v.CreatedAt.Time.UTC().Format(time.RFC3339)
	}
	return out
}

// documentVersionResultSDO renders the commit response: document (with the
// file block the result carries) plus the version row.
func documentVersionResultSDO(doc db.Document, access service.DocumentAccess, file service.DocumentFileInfo, v db.DocumentVersion) sdo.DocumentVersionResultSDO {
	return sdo.DocumentVersionResultSDO{
		Document: documentResultDTO(doc, access, file),
		Version:  documentVersionDTO(v, false),
	}
}
