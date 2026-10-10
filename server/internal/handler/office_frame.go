package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/telemetry"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

type officeFrameCtxKey struct{}

// officeFrameAuth is the only credential check of /api/v1/office-frame/*: the
// frame token as Bearer, or on an image GET the ?sig= of a URL signed for
// exactly that asset. A session token is not a frame token and is refused.
// A token for another document answers 404 like a missing one. The user and
// organization land in the context so the flag gates and the reused document
// handlers act as that user. The flag of the token's module (office_docs_web,
// office_pdf_web, ...) is evaluated here, for the token's organization, since
// only the token names the module: off answers 404 feature_disabled exactly as
// the route-level flag middleware does.
func (h *handlers) officeFrameAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if h.OfficeFrame == nil {
			respondError(w, http.StatusNotFound, "not_found", "not found")
			return
		}
		documentID := chi.URLParam(r, "documentID")
		var (
			claims service.OfficeFrameClaims
			err    error
		)
		if token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok && token != "" {
			claims, err = h.OfficeFrame.Verify(token)
		} else if sig, assetID := r.URL.Query().Get("sig"), chi.URLParam(r, "assetID"); sig != "" && assetID != "" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
			claims, err = h.OfficeFrame.VerifyAsset(sig, documentID, assetID)
		} else if linkedID := chi.URLParam(r, "linkedDocumentID"); sig != "" && linkedID != "" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
			claims, err = h.OfficeFrame.VerifyLinked(sig, documentID, linkedID)
		} else {
			err = service.ErrOfficeFrameToken
		}
		if err != nil {
			officeFrameUnauthorized(w)
			return
		}
		if documentID != "" && documentID != claims.DocumentID {
			respondError(w, http.StatusNotFound, "not_found", "not found")
			return
		}
		platform, _, _ := middleware.ClientMetadataFromContext(r.Context())
		telemetry.SetActor(r.Context(), claims.UserID, string(audit.KindHuman), platform)
		ctx := middleware.WithUserID(r.Context(), claims.UserID)
		ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: claims.UserID, WorkspaceID: claims.WorkspaceID, OrganizationID: claims.OrganizationID})
		if !officeFrameModuleEnabled(ctx, h.FeatureFlags, claims) {
			respondError(w, http.StatusNotFound, "feature_disabled", "feature is disabled")
			return
		}
		ctx = context.WithValue(ctx, officeFrameCtxKey{}, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func officeFrameUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	respondError(w, http.StatusUnauthorized, "unauthorized", "invalid frame token")
}

func officeFrameClaims(r *http.Request) service.OfficeFrameClaims {
	c, _ := r.Context().Value(officeFrameCtxKey{}).(service.OfficeFrameClaims)
	return c
}

func officeFrameTokenSDO(t service.OfficeFrameToken, now time.Time) sdo.OfficeFrameTokenSDO {
	return sdo.OfficeFrameTokenSDO{
		Token: t.Token, TokenType: "Bearer", ExpiresAt: t.ExpiresAt.UTC().Format(time.RFC3339),
		ExpiresIn:  max(0, int(t.ExpiresAt.Sub(now).Seconds())),
		DocumentID: t.Claims.DocumentID, WorkspaceID: t.Claims.WorkspaceID, OrganizationID: t.Claims.OrganizationID,
		CanEdit: t.CanEdit, Module: t.Claims.ModuleName(),
	}
}

func officeFrameDocumentSDO(d service.OfficeFrameDocument) sdo.OfficeFrameDocumentSDO {
	out := sdo.OfficeFrameDocumentSDO{
		DocumentID: d.Document.ID, WorkspaceID: d.Document.WorkspaceID, OrganizationID: d.Document.OrganizationID,
		Title: d.Document.Title, Revision: strconv.FormatInt(d.Document.Revision, 10), Module: d.Module,
		CanEdit:     d.Access.Level == service.DocumentLevelEdit || d.Access.Level == service.DocumentLevelManage,
		File:        documentFileDTO(d.File),
		DownloadURL: "/api/v1/office-frame/documents/" + d.Document.ID + "/content?version=" + strconv.Itoa(int(d.File.Version)),
	}
	if d.Document.UpdatedAt.Valid {
		out.UpdatedAt = d.Document.UpdatedAt.Time.UTC().Format(time.RFC3339)
	}
	return out
}

// mintOfficeFrameToken is POST /documents/{documentID}/office/frame-token: the
// host page, with its session, asks for the frame's credential.
func (h *handlers) mintOfficeFrameToken(w http.ResponseWriter, r *http.Request) {
	if h.OfficeFrame == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "office frame is not configured")
		return
	}
	t, err := h.OfficeFrame.Mint(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"))
	if errors.Is(err, service.ErrOfficeFrameTooLarge) && !officeFrameModuleEnabled(r.Context(), h.FeatureFlags, t.Claims) {
		// The flag answers first: off is 403 whatever the size.
		respondError(w, http.StatusForbidden, "feature_disabled", "feature is disabled")
		return
	}
	if errors.Is(err, service.ErrOfficeFrameTooLarge) {
		// Over the module's size cap (Sheets, GO-D3): the host opens the G3 editor instead.
		respondError(w, http.StatusRequestEntityTooLarge, "too_large", "document is too large for the web frame")
		return
	}
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	// The flag is organization-scoped, so it is read for the organization the
	// document belongs to (the frame routes read it from the token the same
	// way). Mint only signs: nothing is written or audited before this point,
	// and a caller the ACL refuses never reaches it, so the answer reveals
	// nothing a non-member could not already see.
	// 403 feature_disabled, not 404: the host must tell "the frame is off for
	// this organization" (fall back to the G3 editor) from "no such document".
	if !officeFrameModuleEnabled(r.Context(), h.FeatureFlags, t.Claims) {
		respondError(w, http.StatusForbidden, "feature_disabled", "feature is disabled")
		return
	}
	out := officeFrameTokenSDO(t, time.Now())
	out.AI = h.officeFrameAIGrant(r.Context(), t.Claims)
	respondOfficeJSON(w, http.StatusCreated, out)
}

// officeFrameModuleEnabled evaluates the flag of the token's module
// (office_docs_web for a token without m) for the user, workspace and
// organization the token is bound to. A token naming no known module is off.
func officeFrameModuleEnabled(ctx context.Context, flags *featureflag.Service, claims service.OfficeFrameClaims) bool {
	key, ok := service.OfficeFrameModuleFlag(claims.ModuleName())
	if !ok {
		return false
	}
	def := false
	if f, ok := featureflags.Lookup(key); ok {
		def = f.Default
	}
	ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: claims.UserID, WorkspaceID: claims.WorkspaceID, OrganizationID: claims.OrganizationID})
	return flags.IsEnabled(ctx, key, def)
}

// openOfficeFrameDocument is GET /office-frame/documents/{documentID}. A
// Markdown/HTML document also answers the signed URLs of its relative
// references (`assets`).
func (h *handlers) openOfficeFrameDocument(w http.ResponseWriter, r *http.Request) {
	claims := officeFrameClaims(r)
	d, err := h.OfficeFrame.Open(r.Context(), claims)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := officeFrameDocumentSDO(d)
	out.Assets = h.OfficeFrame.OpenAssets(r.Context(), claims, d)
	respondOfficeJSON(w, http.StatusOK, out)
}

// getOfficeFrameContent is GET|HEAD /office-frame/documents/{documentID}/content:
// the Documents download route, as the token's user.
func (h *handlers) getOfficeFrameContent(w http.ResponseWriter, r *http.Request) {
	if _, err := h.OfficeFrame.Authorize(r.Context(), officeFrameClaims(r)); err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.downloadDocument(w, r)
}

// uploadOfficeFrameFile is POST /office-frame/documents/{documentID}/uploads:
// the Documents staging route (FileService, document_file purpose).
func (h *handlers) uploadOfficeFrameFile(w http.ResponseWriter, r *http.Request) {
	if _, err := h.OfficeFrame.Authorize(r.Context(), officeFrameClaims(r)); err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.uploadDocumentFile(w, r)
}

// commitOfficeFrameVersion is POST
// /office-frame/documents/{documentID}/versions/commit: the Documents commit
// (audit + outbox in its transaction). A stale base answers 409
// document_version_conflict with fields.current_revision.
func (h *handlers) commitOfficeFrameVersion(w http.ResponseWriter, r *http.Request) {
	claims := officeFrameClaims(r)
	if _, err := h.OfficeFrame.Authorize(r.Context(), claims); err != nil {
		h.mapServiceError(w, err)
		return
	}
	var in sdi.CommitOfficeFrameVersionSDI
	if !decode(w, r, &in, maxDocumentJSONBody) {
		return
	}
	base, err := strconv.ParseInt(strings.TrimSpace(in.BaseRevision), 10, 64)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "base_revision must be a decimal string")
		return
	}
	res, err := h.Documents.CommitFileVersion(r.Context(), service.Human(claims.UserID), claims.DocumentID, service.CommitFileVersionInput{
		UploadID:       strings.TrimSpace(in.UploadID),
		BaseRevision:   base,
		IdempotencyKey: r.Header.Get("Idempotency-Key"),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondOfficeJSON(w, http.StatusOK, officeFrameDocumentSDO(service.OfficeFrameDocument{Document: res.Document, Access: res.Access, File: res.File, Module: claims.ModuleName()}))
}

// listOfficeFrameRecents is GET /office-frame/documents/{documentID}/recents.
func (h *handlers) listOfficeFrameRecents(w http.ResponseWriter, r *http.Request) {
	limit := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 50 {
			respondError(w, http.StatusBadRequest, "invalid_request", "limit must be 1..50")
			return
		}
		limit = n
	}
	claims := officeFrameClaims(r)
	if _, err := h.OfficeFrame.Authorize(r.Context(), claims); err != nil {
		h.mapServiceError(w, err)
		return
	}
	docs, err := h.OfficeFrame.Recents(r.Context(), claims, limit)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.OfficeFrameRecentsSDO{Items: make([]sdo.OfficeFrameRecentDTO, 0, len(docs))}
	for _, d := range docs {
		item := sdo.OfficeFrameRecentDTO{DocumentID: d.ID, Title: d.Title}
		if d.UpdatedAt.Valid {
			item.UpdatedAt = d.UpdatedAt.Time.UTC().Format(time.RFC3339)
		}
		out.Items = append(out.Items, item)
	}
	respondOfficeJSON(w, http.StatusOK, out)
}

// uploadOfficeFrameAsset is POST /office-frame/documents/{documentID}/assets.
func (h *handlers) uploadOfficeFrameAsset(w http.ResponseWriter, r *http.Request) {
	claims := officeFrameClaims(r)
	file, _, ok := documentUploadForm(w, r, documentAssetMultipartCap)
	if !ok {
		return
	}
	defer file.Close()
	part := &cappedDocumentPart{r: file, max: 10 << 20}
	asset, err := h.OfficeFrame.UploadAsset(r.Context(), claims, service.DocumentUploadInput{
		Filename:       file.FileName(),
		Body:           part,
		IdempotencyKey: r.Header.Get("Idempotency-Key"),
	})
	if err != nil {
		h.mapDocumentUploadError(w, part, err)
		return
	}
	signed, err := h.OfficeFrame.SignAsset(claims, asset.ID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.OfficeFrameAssetSDO{
		AssetID: asset.ID, DocumentID: asset.DocumentID, MimeType: asset.MimeType, SizeBytes: asset.SizeBytes,
		URL: signed.URL, ExpiresAt: signed.ExpiresAt.UTC().Format(time.RFC3339),
	}
	if asset.Width.Valid {
		out.Width = &asset.Width.Int32
	}
	if asset.Height.Valid {
		out.Height = &asset.Height.Int32
	}
	respondOfficeJSON(w, http.StatusCreated, out)
}

// signOfficeFrameAssets is POST /office-frame/documents/{documentID}/assets/sign.
func (h *handlers) signOfficeFrameAssets(w http.ResponseWriter, r *http.Request) {
	var in sdi.SignOfficeFrameAssetsSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	claims := officeFrameClaims(r)
	if _, err := h.OfficeFrame.Authorize(r.Context(), claims); err != nil {
		h.mapServiceError(w, err)
		return
	}
	urls, err := h.OfficeFrame.SignAssets(r.Context(), claims, in.AssetIDs)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.OfficeFrameAssetURLsSDO{Items: make([]sdo.OfficeFrameAssetURLDTO, 0, len(urls))}
	for _, u := range urls {
		out.Items = append(out.Items, sdo.OfficeFrameAssetURLDTO{AssetID: u.AssetID, URL: u.URL, ExpiresAt: u.ExpiresAt.UTC().Format(time.RFC3339)})
	}
	respondOfficeJSON(w, http.StatusOK, out)
}

// getOfficeFrameAsset is GET|HEAD /office-frame/documents/{documentID}/assets/{assetID}:
// the Documents asset proxy, as the token's (or signature's) user.
func (h *handlers) getOfficeFrameAsset(w http.ResponseWriter, r *http.Request) {
	if _, err := h.OfficeFrame.Authorize(r.Context(), officeFrameClaims(r)); err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.getDocumentAsset(w, r)
}

// getOfficeFrameLinked is GET|HEAD
// /office-frame/documents/{documentID}/linked/{linkedDocumentID}: the bytes of
// a file document next to a Markdown/HTML document (a picture, stylesheet or
// script it loads by relative path), typed by its extension. The same headers
// as every Documents byte route: sandbox CSP, nosniff, no-store.
func (h *handlers) getOfficeFrameLinked(w http.ResponseWriter, r *http.Request) {
	f, err := h.OfficeFrame.OpenLinked(r.Context(), officeFrameClaims(r), chi.URLParam(r, "linkedDocumentID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	defer f.Reader.Close()
	h.serveDocumentFile(w, r, documentFilePayload{
		Body:        f.Reader.Body,
		SizeBytes:   f.Reader.File.SizeBytes,
		ContentType: f.ContentType,
		Filename:    f.Filename,
		Disposition: storage.ContentDisposition(f.ContentType, f.Filename),
		Checksum:    f.Reader.File.ChecksumSHA256,
	}, service.DocumentByteRange{}, false)
}
