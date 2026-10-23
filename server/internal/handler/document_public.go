package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// Anonymous public-link HTTP (C-01 §5.3 + §14.2; UNI-679, G1-05b). These
// routes sit OUTSIDE RequireAuth: the token in the path is the only
// credential. Every read re-checks liveness, expiry, the organization switch
// and the entitlement inside DocumentService, and a refusal is the same 404
// for every reason - a public caller learns nothing but the document it was
// explicitly handed. The org `documents` flag is evaluated on the document's
// own organization (the route cannot use the caller's context: there is none).
//
// The download/asset routes stream through Go with Range support, exactly
// like their authenticated twins; no presigned URL ever reaches a client.

// publicDocumentsEnabled evaluates the `documents` flag for the document's
// organization. The service resolves the document first, so the flag gates
// the response, not the lookup.
func (h *handlers) publicDocumentsEnabled(r *http.Request, organizationID string) bool {
	def := false
	if flag, ok := featureflags.Lookup("documents"); ok {
		def = flag.Default
	}
	ctx := featureflag.WithEvalContext(r.Context(), featureflag.EvalContext{OrganizationID: organizationID})
	return h.FeatureFlags.IsEnabled(ctx, "documents", def)
}

// getPublicDocument is GET /public/documents/{token}: the read-only view of a
// page (sanitized content) or the download descriptor of a file. Revoked,
// expired or disabled links answer 404.
func (h *handlers) getPublicDocument(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	token := chi.URLParam(r, "token")
	// Gate the flag on the side-effect-free resolve first: a denied read must
	// not count a view or write an access-log row (BE05B-03).
	pub, err := h.Documents.ResolvePublicDocument(r.Context(), token)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	if !h.publicDocumentsEnabled(r, pub.Document.OrganizationID) {
		respondError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	// The side-effecting open re-resolves, so a revoke that lands in between
	// still refuses the read; the view is counted only now that the gate passed.
	pub, err = h.Documents.OpenPublicDocument(r.Context(), token)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.PublicDocumentSDO{Document: sdo.PublicDocumentDTO{Title: pub.Document.Title, Kind: pub.Document.Kind}}
	switch pub.Document.Kind {
	case service.DocumentKindPage:
		if len(pub.Document.Content) > 0 {
			raw := json.RawMessage(pub.Document.Content)
			out.Document.Content = &raw
		}
	case service.DocumentKindFile:
		download := "/api/v1/public/documents/" + url.PathEscape(token) + "/download"
		out.Document.DownloadURL = &download
	}
	respondJSON(w, http.StatusOK, out)
}

// downloadPublicDocument is GET|HEAD /public/documents/{token}/download: the
// current file version of a file document behind a live link, streamed with
// Range support and always as an attachment. openPublicBytes gates the
// organization's documents flag before it opens anything, so a denied read
// leaves no log row behind.
func (h *handlers) downloadPublicDocument(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	b, ok := h.openPublicBytes(w, r, chi.URLParam(r, "token"), "")
	if !ok {
		return
	}
	defer b.closer.Close()
	h.serveDocumentFile(w, r, b.payload, b.rng, b.ranged)
}

// getPublicDocumentAsset is GET|HEAD /public/documents/{token}/assets/{assetID}:
// one page asset behind a live link; images serve inline, everything else
// downloads. The asset must belong to the link's document (service-checked)
// and openPublicBytes gates the flag before the open.
func (h *handlers) getPublicDocumentAsset(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	b, ok := h.openPublicBytes(w, r, chi.URLParam(r, "token"), chi.URLParam(r, "assetID"))
	if !ok {
		return
	}
	defer b.closer.Close()
	h.serveDocumentFile(w, r, b.payload, b.rng, b.ranged)
}

// publicByteRoute is one opened public byte stream plus what the response
// writer needs: the payload, the closer and the effective Range window.
type publicByteRoute struct {
	payload documentFilePayload
	closer  io.Closer
	rng     service.DocumentByteRange
	ranged  bool
}

// openPublicBytes resolves the Range header into the service window and opens
// the public bytes once (a suffix range costs a 1-byte probe to learn the
// size first). assetID empty selects the file-download route. The organization
// documents flag is evaluated on a side-effect-free resolve before any byte
// open: the open records the access-log row, and a denied read must leave no
// view count and no log behind it (BE05B-03/BE05B-08). The caller owns the
// returned closer.
func (h *handlers) openPublicBytes(w http.ResponseWriter, r *http.Request, token, assetID string) (publicByteRoute, bool) {
	pub, err := h.Documents.ResolvePublicDocument(r.Context(), token)
	if err != nil {
		h.mapServiceError(w, err)
		return publicByteRoute{}, false
	}
	if !h.publicDocumentsEnabled(r, pub.Document.OrganizationID) {
		respondError(w, http.StatusNotFound, "not_found", "not found")
		return publicByteRoute{}, false
	}
	open := func(rng service.DocumentByteRange) (documentFilePayload, io.Closer, error) {
		if assetID != "" {
			rd, err := h.Documents.OpenPublicDocumentAsset(r.Context(), token, assetID, rng)
			if err != nil {
				return documentFilePayload{}, nil, err
			}
			return documentFilePayload{
				Body:        rd.Reader.Body,
				SizeBytes:   rd.Reader.File.SizeBytes,
				ContentType: rd.Reader.File.ContentType,
				Filename:    rd.Reader.File.Filename,
				Disposition: storage.ContentDisposition(rd.Reader.File.ContentType, rd.Reader.File.Filename),
				Checksum:    rd.Reader.File.ChecksumSHA256,
			}, rd.Reader, nil
		}
		f, err := h.Documents.OpenPublicDocumentFile(r.Context(), token, rng)
		if err != nil {
			return documentFilePayload{}, nil, err
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
		return payload, f.Reader, nil
	}

	spec := parseDocumentRange(r)
	rng := service.DocumentByteRange{Offset: spec.offset, Length: spec.length}
	if spec.suffix > 0 {
		probe, closer, err := open(service.DocumentByteRange{Length: 1})
		if err != nil {
			h.mapServiceError(w, err)
			return publicByteRoute{}, false
		}
		size := probe.SizeBytes
		_ = closer.Close()
		if spec.suffix >= size {
			rng = service.DocumentByteRange{}
		} else {
			rng = service.DocumentByteRange{Offset: size - spec.suffix, Length: spec.suffix}
		}
	}
	payload, closer, err := open(rng)
	if err != nil {
		h.mapServiceError(w, err)
		return publicByteRoute{}, false
	}
	return publicByteRoute{payload: payload, closer: closer, rng: rng, ranged: spec.has}, true
}
