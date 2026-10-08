package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// tag: documents — Office Docs web frame (UNI-1013). The host page mints a
// frame token with its session (registerOfficeFrameToken, inside the
// authenticated group); the genoffice Docs frame then calls the routes below
// with that token alone as `Authorization: Bearer`, so the frame needs no
// cookie and can move to its own origin later. A token opens exactly one
// document: a path naming another document, or a session token, is refused.
//
//	POST   /api/v1/documents/{documentID}/office/frame-token            (session)
//	POST   /api/v1/office-frame/token                                   (refresh)
//	GET    /api/v1/office-frame/documents/{documentID}                  (open)
//	GET    /api/v1/office-frame/documents/{documentID}/content          (bytes; HEAD)
//	POST   /api/v1/office-frame/documents/{documentID}/uploads          (save intent)
//	POST   /api/v1/office-frame/documents/{documentID}/versions/commit  (save)
//	GET    /api/v1/office-frame/documents/{documentID}/recents
//	POST   /api/v1/office-frame/documents/{documentID}/assets
//	POST   /api/v1/office-frame/documents/{documentID}/assets/sign
//	GET    /api/v1/office-frame/documents/{documentID}/assets/{assetID} (bytes; HEAD)
func registerOfficeFrameToken(r api, h Routes, flags *featureflag.Service) {
	d := r.With(mw.RequireFeatureFlag(flags, "documents"), mw.RequireFeatureFlag(flags, "office_docs_web"))
	d.Post("/documents/{documentID}/office/frame-token", h.MintOfficeFrameToken, apiOp{
		summary: "Mint an Office Docs frame token",
		description: "Host page only: checks the live ACL of a DOCX file document and returns a server-signed token (10 min) bound to this document, its workspace and the caller. " +
			"The host passes it to the frame in the postMessage init; it opens only /api/v1/office-frame/* for this document and is refused everywhere else.",
		tags: []string{"documents"}, sdo: sdo.OfficeFrameTokenSDO{}, status: http.StatusCreated, auth: true,
	})
}

func registerOfficeFrame(r api, h Routes, flags *featureflag.Service) {
	if h.OfficeFrameAuth == nil {
		return
	}
	// Auth first so the flags evaluate with the token's user and organization.
	f := r.With(h.OfficeFrameAuth, mw.RequireFeatureFlag(flags, "documents"), mw.RequireFeatureFlag(flags, "office_docs_web"))
	f.Post("/office-frame/token", h.RefreshOfficeFrameToken, apiOp{
		summary:     "Refresh an Office Docs frame token",
		description: "Frame token only: rechecks the ACL and returns a fresh token for the same document. An expired token cannot refresh; the frame asks the host to mint again.",
		tags:        []string{"documents"}, sdo: sdo.OfficeFrameTokenSDO{}, auth: true,
	})
	f.Get("/office-frame/documents/{documentID}", h.OpenOfficeFrameDocument, apiOp{
		summary:     "Open a document in the Office Docs frame",
		description: "Frame token only: title, revision (the save base), current file version and download_url, a first-party route read with the same token. DOCX file documents only.",
		tags:        []string{"documents"}, sdo: sdo.OfficeFrameDocumentSDO{}, auth: true,
	})
	f.Get("/office-frame/documents/{documentID}/content", h.GetOfficeFrameContent, apiOp{
		summary:     "Stream the document bytes to the frame",
		description: "Frame token only: bytes of the current version (or ?version=N). HEAD, Range, X-Checksum-Sha256 as GET /documents/{id}/download.",
		tags:        []string{"documents"}, sdi: sdi.DownloadDocumentSDI{}, produces: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", auth: true,
	})
	f.r.Head("/office-frame/documents/{documentID}/content", h.GetOfficeFrameContent)
	f.cat.add(http.MethodHead, joinRoute(f.prefix, "/office-frame/documents/{documentID}/content"), apiOp{
		summary:     "Headers of the frame document bytes",
		description: "Như GET nhưng không có body. Kiểm token và quyền giống GET.",
		tags:        []string{"documents"},
	})
	f.Post("/office-frame/documents/{documentID}/uploads", h.UploadOfficeFrameFile, apiOp{
		summary:     "Stage the bytes of a frame save",
		description: "Frame token only, edit access: multipart (≤ 50 MiB) staging the new DOCX bytes. Returns upload_id for .../versions/commit. Idempotency-Key makes a retry find the same upload.",
		tags:        []string{"documents"}, sdi: sdi.UploadOfficeFrameFileSDI{}, sdo: sdo.DocumentUploadSDO{}, status: http.StatusCreated, auth: true,
	})
	f.Post("/office-frame/documents/{documentID}/versions/commit", h.CommitOfficeFrameVersion, apiOp{
		summary: "Save the frame's staged bytes as a new version",
		description: "Frame token only, edit access: {upload_id, base_revision} + Idempotency-Key appends a Documents version (audit + outbox in the same transaction). " +
			"A stale base_revision answers 409 document_version_conflict with fields.current_revision; the answer is the document as an open would return it.",
		tags: []string{"documents"}, sdi: sdi.CommitOfficeFrameVersionSDI{}, sdo: sdo.OfficeFrameDocumentSDO{}, auth: true,
	})
	f.Get("/office-frame/documents/{documentID}/recents", h.ListOfficeFrameRecents, apiOp{
		summary:     "Recent DOCX documents for the frame",
		description: "Frame token only: the caller's recently opened or edited DOCX file documents in the token's workspace, newest first. Opening one goes through the host, which mints a new token.",
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
