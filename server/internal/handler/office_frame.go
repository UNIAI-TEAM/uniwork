package handler

import (
	"context"
	"io"
	"net/http"
	"net/url"
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

// officeFrameSourceCtxKey carries the source claims of an
// /api/v1/office-frame/sources/* request. It is a distinct key, never mixed
// with officeFrameCtxKey: the two claim types are not interchangeable.
type officeFrameSourceCtxKey struct{}

// officeFrameAuth is the only credential check of /api/v1/office-frame/*: the
// frame token as Bearer, or on an image GET the ?sig= of a URL signed for
// exactly that asset; a sibling file (.../linked/{id}) takes the ?sig= alone.
// A session token is not a frame token and is refused.
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
		// The source subtree (UNI-1869): a source token (ofs1.), never a
		// document token, a session or a signature.
		if chi.URLParam(r, "sourceFileID") != "" {
			h.officeFrameSourceAuth(next, w, r)
			return
		}
		documentID := chi.URLParam(r, "documentID")
		var (
			claims service.OfficeFrameClaims
			err    error
		)
		sig := r.URL.Query().Get("sig")
		safe := r.Method == http.MethodGet || r.Method == http.MethodHead
		token, bearer := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		bearer = bearer && token != ""
		switch linkedID, assetID := chi.URLParam(r, "linkedDocumentID"), chi.URLParam(r, "assetID"); {
		case linkedID != "":
			// A sibling file opens only through the signature the open answer (or a
			// resolve) minted for exactly this document and file, never through a
			// frame token: a token binds its own document alone.
			if sig != "" && safe {
				claims, err = h.OfficeFrame.VerifyLinked(sig, documentID, linkedID)
			} else {
				err = service.ErrOfficeFrameToken
			}
		case bearer:
			claims, err = h.OfficeFrame.Verify(token)
		case sig != "" && assetID != "" && safe:
			claims, err = h.OfficeFrame.VerifyAsset(sig, documentID, assetID)
		default:
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
		if !officeFrameModuleEnabled(ctx, h.FeatureFlags, claims.ModuleName(), claims.UserID, claims.WorkspaceID, claims.OrganizationID) {
			respondError(w, http.StatusNotFound, "feature_disabled", "feature is disabled")
			return
		}
		ctx = context.WithValue(ctx, officeFrameCtxKey{}, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// officeFrameSourceAuth is the source half of officeFrameAuth: the frame
// presents a source token as Bearer, and nothing else — no ?sig=, no session.
// The path's {sourceFileID} must equal the token's source, read the way the
// wire sends it (sourceFileIDParam, the download route's own unescape); an id
// that does not decode, or names another source, answers 404 like a missing
// one. The flag of the token's module is evaluated here, as for a document.
func (h *handlers) officeFrameSourceAuth(next http.Handler, w http.ResponseWriter, r *http.Request) {
	token, bearer := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !bearer || token == "" {
		officeFrameUnauthorized(w)
		return
	}
	claims, err := h.OfficeFrame.VerifySource(token)
	if err != nil {
		officeFrameUnauthorized(w)
		return
	}
	want, err := sourceFileIDParam(r)
	if err != nil || want != claims.SourceID {
		respondError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	platform, _, _ := middleware.ClientMetadataFromContext(r.Context())
	telemetry.SetActor(r.Context(), claims.UserID, string(audit.KindHuman), platform)
	ctx := middleware.WithUserID(r.Context(), claims.UserID)
	ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: claims.UserID, WorkspaceID: claims.WorkspaceID, OrganizationID: claims.OrganizationID})
	if !officeFrameModuleEnabled(ctx, h.FeatureFlags, claims.ModuleName(), claims.UserID, claims.WorkspaceID, claims.OrganizationID) {
		respondError(w, http.StatusNotFound, "feature_disabled", "feature is disabled")
		return
	}
	ctx = context.WithValue(ctx, officeFrameSourceCtxKey{}, claims)
	next.ServeHTTP(w, r.WithContext(ctx))
}

func officeFrameUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	respondError(w, http.StatusUnauthorized, "unauthorized", "invalid frame token")
}

func officeFrameClaims(r *http.Request) service.OfficeFrameClaims {
	c, _ := r.Context().Value(officeFrameCtxKey{}).(service.OfficeFrameClaims)
	return c
}

func officeFrameSourceClaims(r *http.Request) service.OfficeFrameSourceClaims {
	c, _ := r.Context().Value(officeFrameSourceCtxKey{}).(service.OfficeFrameSourceClaims)
	return c
}

// officeFrameSourceTokenSDO is the mint answer: can_edit is always false and
// readonly always true — a source frame is view-only by construction. There is
// no AI grant block: source frames get no /ai/* access.
func officeFrameSourceTokenSDO(t service.OfficeFrameSourceToken, now time.Time) sdo.OfficeFrameSourceTokenSDO {
	return sdo.OfficeFrameSourceTokenSDO{
		Token: t.Token, TokenType: "Bearer", ExpiresAt: t.ExpiresAt.UTC().Format(time.RFC3339),
		ExpiresIn: max(0, int(t.ExpiresAt.Sub(now).Seconds())),
		SourceID:  t.Claims.SourceID, ParentKind: t.Claims.ParentKind, ParentID: t.Claims.ParentID,
		WorkspaceID: t.Claims.WorkspaceID, OrganizationID: t.Claims.OrganizationID,
		CanEdit: false, Module: t.Claims.ModuleName(), ReadOnly: true,
	}
}

// officeFrameSourceSDO is the frame's open view of its source file: the same
// field names the frame client reads on a document (title, revision, module,
// file, download_url), with source_id and principal in place of document_id
// (the source is not a Document, OQ-1).
func officeFrameSourceSDO(claims service.OfficeFrameSourceClaims, item service.DocumentSourceItem) sdo.OfficeFrameSourceSDO {
	out := sdo.OfficeFrameSourceSDO{
		SourceID: claims.SourceID, Principal: "source",
		WorkspaceID: claims.WorkspaceID, OrganizationID: claims.OrganizationID,
		Title: item.Name, Revision: "0", Module: claims.ModuleName(),
		CanEdit: false, ReadOnly: true,
		Parent: sdo.DocumentSourceParentDTO{
			Kind: item.Parent.Kind, ID: item.Parent.ID, Title: item.Parent.Title, MessageID: item.Parent.MessageID,
		},
		File: sdo.OfficeFrameSourceFileDTO{
			Version: 1, Filename: item.Name, MimeType: item.MimeType, SizeBytes: item.SizeBytes,
		},
		DownloadURL: "/api/v1/office-frame/sources/" + url.PathEscape(item.ID) + "/content",
	}
	if !item.UpdatedAt.IsZero() {
		out.UpdatedAt = item.UpdatedAt.UTC().Format(time.RFC3339)
	}
	return out
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
	// this organization" (the unavailable notice) from "no such document".
	if !officeFrameModuleEnabled(r.Context(), h.FeatureFlags,
		t.Claims.ModuleName(), t.Claims.UserID, t.Claims.WorkspaceID, t.Claims.OrganizationID) {
		respondError(w, http.StatusForbidden, "feature_disabled", "feature is disabled")
		return
	}
	out := officeFrameTokenSDO(t, time.Now())
	out.AI = h.officeFrameAIGrant(r.Context(), t.Claims)
	respondOfficeJSON(w, http.StatusCreated, out)
}

// officeFrameModuleEnabled evaluates the flag of a frame token's module
// (office_docs_web for a token without m) for the user, workspace and
// organization the token is bound to. A module that is not one of the web
// modules is off. Both claims types (a document's and a source's) reach it
// through their ModuleName.
func officeFrameModuleEnabled(ctx context.Context, flags *featureflag.Service, module, userID, workspaceID, organizationID string) bool {
	key, ok := service.OfficeFrameModuleFlag(module)
	if !ok {
		return false
	}
	def := false
	if f, ok := featureflags.Lookup(key); ok {
		def = f.Default
	}
	ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: userID, WorkspaceID: workspaceID, OrganizationID: organizationID})
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

// mintSourceOfficeFrameToken is POST
// /workspaces/{workspaceID}/documents/sources/{sourceFileID}/office/frame-token:
// the host page, with its session, asks for a view-only source frame token.
// The module flag is organization-scoped and only the source names its
// organization and format, so it is evaluated here once the mint found them
// (as the document mint does).
func (h *handlers) mintSourceOfficeFrameToken(w http.ResponseWriter, r *http.Request) {
	if h.OfficeFrame == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "office frame is not configured")
		return
	}
	sourceFileID, err := sourceFileIDParam(r)
	if err != nil {
		h.mapServiceError(w, service.ErrNotFound)
		return
	}
	t, err := h.OfficeFrame.MintSource(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), sourceFileID)
	flagOn := func(c service.OfficeFrameSourceClaims) bool {
		return officeFrameModuleEnabled(r.Context(), h.FeatureFlags, c.ModuleName(), c.UserID, c.WorkspaceID, c.OrganizationID)
	}
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	// Mint only signs: nothing is written or audited, and a caller the source
	// gate refuses never reaches here. 403 feature_disabled, not 404: the host
	// must tell "the frame is off for this organization" from "no such file".
	if !flagOn(t.Claims) {
		respondError(w, http.StatusForbidden, "feature_disabled", "feature is disabled")
		return
	}
	respondOfficeJSON(w, http.StatusCreated, officeFrameSourceTokenSDO(t, time.Now()))
}

// openOfficeFrameSource is GET /office-frame/sources/{sourceFileID}: the
// frame's view of its source file, rechecked as the token's user.
func (h *handlers) openOfficeFrameSource(w http.ResponseWriter, r *http.Request) {
	claims := officeFrameSourceClaims(r)
	_, item, err := h.OfficeFrame.AuthorizeSource(r.Context(), claims)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondOfficeJSON(w, http.StatusOK, officeFrameSourceSDO(claims, item))
}

// getOfficeFrameSourceContent is GET|HEAD
// /office-frame/sources/{sourceFileID}/content: the source's bytes, as the
// token's user. HEAD runs the lookup only (email's Open refetches over IMAP)
// and promises Content-Length only when the source measures its own length;
// GET streams Open's bytes and uses its exact decoded size.
func (h *handlers) getOfficeFrameSourceContent(w http.ResponseWriter, r *http.Request) {
	claims := officeFrameSourceClaims(r)
	if r.Method == http.MethodHead {
		_, item, err := h.OfficeFrame.AuthorizeSource(r.Context(), claims)
		if err != nil {
			h.mapServiceError(w, err)
			return
		}
		h.setOfficeFrameSourceHeaders(w, item.MimeType, item.Name, officeFrameSourceHeadsLength(item))
		w.WriteHeader(http.StatusOK)
		return
	}
	f, err := h.OfficeFrame.OpenSource(r.Context(), claims)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	defer f.Body.Close()
	h.setOfficeFrameSourceHeaders(w, f.Item.MimeType, f.Item.Name, f.Size)
	w.WriteHeader(http.StatusOK)
	n, err := io.Copy(w, f.Body)
	if (err != nil || (f.Size >= 0 && n != f.Size)) && r.Context().Err() == nil && h.Log != nil {
		h.Log.Warn("office frame source content interrupted", "source", f.Item.Source, "source_file_id", f.Item.ID,
			"bytes_sent", n, "bytes_expected", f.Size, "err", err)
	}
}

// officeFrameSourceHeadsLength is the length a HEAD may promise: the stored
// size for chat/task/meeting (their FileService size is exact), nothing for
// email (its size_bytes is the IMAP encoded length, not the decoded one).
func officeFrameSourceHeadsLength(item service.DocumentSourceItem) int64 {
	if item.Source == service.DocumentSourceEmail || item.SizeBytes < 0 {
		return -1
	}
	return item.SizeBytes
}

// setOfficeFrameSourceHeaders writes the shared source byte-route headers: the
// same sandbox CSP, nosniff and no-store every Documents byte route sets, with
// Content-Disposition by content type (inline for safe types). Content-Length
// is set only when length is known (>= 0).
func (h *handlers) setOfficeFrameSourceHeaders(w http.ResponseWriter, mime, filename string, length int64) {
	contentType := mime
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	header := w.Header()
	header.Set("Content-Type", contentType)
	header.Set("Content-Disposition", storage.ContentDisposition(contentType, filename))
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Cache-Control", "private, no-store")
	header.Set("Content-Security-Policy", "sandbox; default-src 'none'")
	if length >= 0 {
		header.Set("Content-Length", strconv.FormatInt(length, 10))
	}
}

// uploadOfficeFrameFile is POST /office-frame/documents/{documentID}/uploads:
// the Documents staging route (FileService, document_file purpose).
func (h *handlers) uploadOfficeFrameFile(w http.ResponseWriter, r *http.Request) {
	if _, err := h.OfficeFrame.AuthorizeSave(r.Context(), officeFrameClaims(r)); err != nil {
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
	if _, err := h.OfficeFrame.AuthorizeSave(r.Context(), claims); err != nil {
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
	file, _, ok := documentUploadForm(w, r, documentAssetMultipartCap, documentAssetMaxBytes)
	if !ok {
		return
	}
	defer file.Close()
	part := &cappedDocumentPart{r: file, max: documentAssetMaxBytes}
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

// resolveOfficeFrameAssets is POST /office-frame/documents/{documentID}/assets/resolve.
func (h *handlers) resolveOfficeFrameAssets(w http.ResponseWriter, r *http.Request) {
	var in sdi.ResolveOfficeFrameAssetsSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	resolved, err := h.OfficeFrame.Resolve(r.Context(), officeFrameClaims(r), in.Paths)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.OfficeFrameResolvedPathsSDO{Items: make([]sdo.OfficeFrameResolvedPathDTO, 0, len(resolved))}
	for _, p := range in.Paths {
		u, ok := resolved[p]
		if !ok {
			continue
		}
		out.Items = append(out.Items, sdo.OfficeFrameResolvedPathDTO{Path: p, URL: u.URL, ExpiresAt: u.ExpiresAt.UTC().Format(time.RFC3339)})
		delete(resolved, p) // a path sent twice answers once
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
