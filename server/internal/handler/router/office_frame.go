package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// tag: documents — Office web frames: Docs (UNI-1013) and the other genoffice
// modules (pdf, markdown, html, slides, sheets; UNI-1014/1015/1016). The host
// page mints a frame token with its session (registerOfficeFrameToken, inside the
// authenticated group); the genoffice Docs frame then calls the routes below
// with that token alone as `Authorization: Bearer`, so the frame needs no
// cookie and can move to its own origin later. A token opens exactly one
// document: a path naming another document, or a session token, is refused.
// There is no frame-token refresh route: the frame's token.refresh message is
// answered by the host, which mints again with its session. The routes are the
// same for every module: the token names its module (derived from the stored
// format at mint), and the frame auth middleware evaluates that module's flag
// (office_docs_web, office_pdf_web, ...) for the token's organization.
//
//	POST   /api/v1/documents/{documentID}/office/frame-token            (session)
//	GET    /api/v1/office-frame/documents/{documentID}                  (open)
//	GET    /api/v1/office-frame/documents/{documentID}/content          (bytes; HEAD)
//	POST   /api/v1/office-frame/documents/{documentID}/uploads          (save intent)
//	POST   /api/v1/office-frame/documents/{documentID}/versions/commit  (save)
//	GET    /api/v1/office-frame/documents/{documentID}/recents
//	POST   /api/v1/office-frame/documents/{documentID}/assets
//	POST   /api/v1/office-frame/documents/{documentID}/assets/sign
//	GET    /api/v1/office-frame/documents/{documentID}/assets/{assetID} (bytes; HEAD)
func registerOfficeFrameToken(r api, h Routes, flags *featureflag.Service) {
	// The module flags are not middleware here: they are organization-scoped
	// and only the document names its organization and format, so
	// mintOfficeFrameToken evaluates the module's flag for that organization
	// once the ACL check has found it.
	d := r.With(mw.RequireFeatureFlag(flags, "documents"))
	d.Post("/documents/{documentID}/office/frame-token", h.MintOfficeFrameToken, apiOp{
		summary: "Mint an Office web frame token",
		description: "Host page only: checks the live ACL of a file document a web module opens (docx, pdf, md, html, pptx, xlsx) and returns a server-signed token (10 min) bound to this document, its workspace, the caller and the module derived from the stored format. " +
			"403 feature_disabled when that module's flag is off for the document's organization; 413 too_large when the stored file is over the module's cap (sheets: 10 MiB). " +
			"The host passes it to the frame in the postMessage init; it opens only /api/v1/office-frame/* for this document and is refused everywhere else.",
		tags: []string{"documents"}, sdo: sdo.OfficeFrameTokenSDO{}, status: http.StatusCreated, auth: true,
	})
}

func registerOfficeFrame(r api, h Routes, flags *featureflag.Service, frameAuth func(http.Handler) http.Handler) {
	if frameAuth == nil {
		frameAuth = frameAuthNotFound
	}
	// Auth first so the flags evaluate with the token's user and organization;
	// frameAuth itself checks the flag of the token's module.
	f := r.With(frameAuth, mw.RequireFeatureFlag(flags, "documents"))
	f.Get("/office-frame/documents/{documentID}", h.OpenOfficeFrameDocument, apiOp{
		summary:     "Open a document in the Office web frame",
		description: "Frame token only: title, revision (the save base), module, current file version and download_url, a first-party route read with the same token. A document whose current version is no longer of the token's module answers 404.",
		tags:        []string{"documents"}, sdo: sdo.OfficeFrameDocumentSDO{}, auth: true,
	})
	f.Get("/office-frame/documents/{documentID}/content", h.GetOfficeFrameContent, apiOp{
		summary:     "Stream the document bytes to the frame",
		description: "Frame token only: bytes of the current version (or ?version=N). HEAD, Range, X-Checksum-Sha256 as GET /documents/{id}/download.",
		tags:        []string{"documents"}, sdi: sdi.DownloadDocumentSDI{}, produces: "application/octet-stream", auth: true,
	})
	f.r.Head("/office-frame/documents/{documentID}/content", h.GetOfficeFrameContent)
	f.cat.add(http.MethodHead, joinRoute(f.prefix, "/office-frame/documents/{documentID}/content"), apiOp{
		summary:     "Headers of the frame document bytes",
		description: "Như GET nhưng không có body. Kiểm token và quyền giống GET.",
		tags:        []string{"documents"},
	})
	f.Post("/office-frame/documents/{documentID}/uploads", h.UploadOfficeFrameFile, apiOp{
		summary:     "Stage the bytes of a frame save",
		description: "Frame token only, edit access: multipart (≤ 50 MiB) staging the new bytes of the document. Returns upload_id for .../versions/commit. Idempotency-Key makes a retry find the same upload.",
		tags:        []string{"documents"}, sdi: sdi.UploadOfficeFrameFileSDI{}, sdo: sdo.DocumentUploadSDO{}, status: http.StatusCreated, auth: true,
	})
	f.Post("/office-frame/documents/{documentID}/versions/commit", h.CommitOfficeFrameVersion, apiOp{
		summary: "Save the frame's staged bytes as a new version",
		description: "Frame token only, edit access: {upload_id, base_revision} + Idempotency-Key appends a Documents version (audit + outbox in the same transaction). " +
			"A stale base_revision answers 409 document_version_conflict with fields.current_revision; the answer is the document as an open would return it.",
		tags: []string{"documents"}, sdi: sdi.CommitOfficeFrameVersionSDI{}, sdo: sdo.OfficeFrameDocumentSDO{}, auth: true,
	})
	f.Get("/office-frame/documents/{documentID}/recents", h.ListOfficeFrameRecents, apiOp{
		summary:     "Recent documents for the frame",
		description: "Frame token only: the caller's recently opened or edited file documents of the token's module in its workspace, newest first. Opening one goes through the host, which mints a new token.",
		tags:        []string{"documents"}, sdi: sdi.ListOfficeFrameRecentsSDI{}, sdo: sdo.OfficeFrameRecentsSDO{}, auth: true,
	})
	f.Post("/office-frame/documents/{documentID}/assets", h.UploadOfficeFrameAsset, apiOp{
		summary:     "Upload an image the document embeds",
		description: "Frame token only, edit access: multipart image (≤ 10 MiB, image allowlist) attached to the token's document. Returns a short-lived signed URL.",
		tags:        []string{"documents"}, sdi: sdi.UploadOfficeFrameAssetSDI{}, sdo: sdo.OfficeFrameAssetSDO{}, status: http.StatusCreated, auth: true,
	})
	f.Post("/office-frame/documents/{documentID}/assets/sign", h.SignOfficeFrameAssets, apiOp{
		summary:     "Sign image URLs for the frame",
		description: "Frame token only: fresh signed URLs for assets of the token's document. An asset of another document answers 404.",
		tags:        []string{"documents"}, sdi: sdi.SignOfficeFrameAssetsSDI{}, sdo: sdo.OfficeFrameAssetURLsSDO{}, auth: true,
	})
	f.Get("/office-frame/documents/{documentID}/assets/{assetID}", h.GetOfficeFrameAsset, apiOp{
		summary:     "Stream an image of the frame's document",
		description: "Frame token as Bearer, or the ?sig= of a signed URL bound to this asset. Rechecks view access on every request. Cache-Control: private, no-store.",
		tags:        []string{"documents"}, produces: "application/octet-stream", auth: true,
	})
	f.r.Head("/office-frame/documents/{documentID}/assets/{assetID}", h.GetOfficeFrameAsset)
	f.cat.add(http.MethodHead, joinRoute(f.prefix, "/office-frame/documents/{documentID}/assets/{assetID}"), apiOp{
		summary:     "Headers of a frame image",
		description: "Như GET nhưng không có body.",
		tags:        []string{"documents"},
	})
}
