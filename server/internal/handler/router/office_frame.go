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
//	POST   /api/v1/office-frame/documents/{documentID}/upload-sessions  (BIGUP-S1: large save)
//	GET    /api/v1/office-frame/documents/{documentID}/upload-sessions/{sessionID}          (BIGUP-S1)
//	POST   /api/v1/office-frame/documents/{documentID}/upload-sessions/{sessionID}/complete (BIGUP-S1)
//	DELETE /api/v1/office-frame/documents/{documentID}/upload-sessions/{sessionID}          (BIGUP-S1)
//	POST   /api/v1/office-frame/documents/{documentID}/versions/commit  (save)
//	GET    /api/v1/office-frame/documents/{documentID}/recents
//	POST   /api/v1/office-frame/documents/{documentID}/assets
//	POST   /api/v1/office-frame/documents/{documentID}/assets/sign
//	POST   /api/v1/office-frame/documents/{documentID}/assets/resolve    (md/html: relative paths -> signed URLs)
//	GET    /api/v1/office-frame/documents/{documentID}/assets/{assetID} (bytes; HEAD)
//	GET    /api/v1/office-frame/documents/{documentID}/linked/{linkedDocumentID} (bytes; HEAD)
//	GET    /api/v1/office-frame/sources/{sourceFileID}                  (source frame; UNI-1869)
//	GET    /api/v1/office-frame/sources/{sourceFileID}/content          (bytes; HEAD)
func registerOfficeFrameToken(r api, h Routes, flags *featureflag.Service) {
	// The module flags are not middleware here: they are organization-scoped
	// and only the document names its organization and format, so
	// mintOfficeFrameToken evaluates the module's flag for that organization
	// once the ACL check has found it.
	d := r.With(mw.RequireFeatureFlag(flags, "documents"))
	d.Post("/documents/{documentID}/office/frame-token", h.MintOfficeFrameToken, apiOp{
		summary: "Mint an Office web frame token",
		description: "Host page only: checks the live ACL of a file document a web module opens (docx, pdf, md, html, pptx, xlsx) and returns a server-signed token (10 min) bound to this document, its workspace, the caller and the module derived from the stored format. " +
			"403 feature_disabled when that module's flag is off for the document's organization. " +
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
		description: "Frame token only, edit access: multipart (≤ DOCUMENT_MAX_BYTES) staging the new bytes of the document. Returns upload_id for .../versions/commit. Idempotency-Key makes a retry find the same upload.",
		tags:        []string{"documents"}, sdi: sdi.UploadOfficeFrameFileSDI{}, sdo: sdo.DocumentUploadSDO{}, status: http.StatusCreated, auth: true,
	})
	f.Post("/office-frame/documents/{documentID}/upload-sessions", h.CreateFrameUploadSession, apiOp{
		summary: "Open a large frame save session",
		description: "Frame token only, edit access: như POST /api/v1/documents/{id}/upload-sessions nhưng cho lưu từ khung khi tệp vượt ngưỡng một lượt. Phiên ghi document_id của token (token chỉ hợp lệ cho đúng tài liệu đó) và chỉ route frame đọc/hoàn tất/huỷ được nó: route /api/v1/upload-sessions/{id} trả 404 cho phiên này. Cùng ngưỡng, mã lỗi và thứ tự từ chối như route tài liệu; hoàn tất trả 200 DocumentUploadSDO để commit qua /office-frame/documents/{id}/versions/commit. " +
			"Tài liệu đang bị người khác giữ khóa sửa (hoặc một agent) -> 423 document_locked trước khi mở phiên, cùng fields như cổng commit; người giữ token đang giữ khóa hoặc không có khóa sống thì qua.",
		tags: []string{"documents"}, sdi: sdi.CreateUploadSessionSDI{}, sdo: sdo.UploadSessionSDO{}, status: http.StatusCreated, auth: true,
	})
	f.Get("/office-frame/documents/{documentID}/upload-sessions/{sessionID}", h.GetFrameUploadSession, apiOp{
		summary:     "Read a large frame save session",
		description: "Frame token only: cùng shape với GET /api/v1/upload-sessions/{sessionID}, nhưng chỉ cho phiên mở bằng frame token của đúng tài liệu này. Token của tài liệu khác, phiên mở bằng phiên đăng nhập, và id không tồn tại đều trả cùng 404 not_found; phiên hết hạn/huỷ -> 410 upload_session_expired.",
		tags:        []string{"documents"}, sdo: sdo.UploadSessionSDO{}, auth: true,
	})
	f.Post("/office-frame/documents/{documentID}/upload-sessions/{sessionID}/complete", h.CompleteFrameUploadSession, apiOp{
		summary:     "Complete a large frame save session",
		description: "Frame token only, edit access: như POST /api/v1/upload-sessions/{id}/complete; thành công trả 200 DocumentUploadSDO để commit qua /office-frame/documents/{id}/versions/commit. Cùng thứ tự và mã lỗi: 422 upload_parts_invalid / upload_size_mismatch / upload_probe_mismatch, 415 khi nội dung hỏng (object bị xoá, quota được nhả), 409 upload_session_busy + Retry-After: 5 khi một complete khác đang giữ lease.",
		tags:        []string{"documents"}, sdi: sdi.CompleteUploadSessionSDI{}, sdo: sdo.DocumentUploadSDO{}, auth: true,
	})
	f.Delete("/office-frame/documents/{documentID}/upload-sessions/{sessionID}", h.AbortFrameUploadSession, apiOp{
		summary:     "Abort a large frame save session",
		description: "Frame token only: huỷ phiên mở bằng frame token của đúng tài liệu; 204, idempotent với phiên đã huỷ/hết hạn, 409 upload_session_completed nếu đã xong.",
		tags:        []string{"documents"}, status: http.StatusNoContent, auth: true,
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
	f.Post("/office-frame/documents/{documentID}/assets/resolve", h.ResolveOfficeFrameAssets, apiOp{
		summary: "Resolve relative paths of a Markdown/HTML document to signed URLs",
		description: "Frame token only, Markdown and HTML modules (any other answers 404): {paths} (1..50) as written in the document get the same normalisation, tree walk and view ACL as the open answer's assets map. " +
			"Used for fresh URLs when a session outlives the signatures and for paths typed after the open; a path that resolves to nothing is absent from items.",
		tags: []string{"documents"}, sdi: sdi.ResolveOfficeFrameAssetsSDI{}, sdo: sdo.OfficeFrameResolvedPathsSDO{}, auth: true,
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
	f.Get("/office-frame/documents/{documentID}/linked/{linkedDocumentID}", h.GetOfficeFrameLinked, apiOp{
		summary: "Stream a file next to the frame's Markdown/HTML document",
		description: "The ?sig= of a URL the open answer's (or a resolve's) assets map signed for exactly this document and file; a frame token as Bearer is refused with 401, as is a signature naming another module than Markdown or HTML. " +
			"A live file document in the token's workspace that the token's user may view (rechecked on every request, together with the frame's document) and of a type the frames load: PNG, JPEG, GIF, WebP, SVG, CSS, JavaScript; anything else answers 404. " +
			"Content-Type by the file's extension, nosniff, Content-Security-Policy sandbox, Cache-Control: private, no-store.",
		tags: []string{"documents"}, produces: "application/octet-stream", auth: true,
	})
	f.r.Head("/office-frame/documents/{documentID}/linked/{linkedDocumentID}", h.GetOfficeFrameLinked)
	f.cat.add(http.MethodHead, joinRoute(f.prefix, "/office-frame/documents/{documentID}/linked/{linkedDocumentID}"), apiOp{
		summary:     "Headers of a file next to the frame's document",
		description: "Như GET nhưng không có body.",
		tags:        []string{"documents"},
	})
	// The source frame (UNI-1869): a view-only frame over a file that lives in
	// Chat, Tasks, Meetings or Email Hub — the same modules, the same token
	// machinery, a "source" principal instead of a document.
	f.Get("/office-frame/sources/{sourceFileID}", h.OpenOfficeFrameSource, apiOp{
		summary: "Open a source file in the Office web frame",
		description: "Chỉ token nguồn (ofs1.): tên tệp, revision (luôn \"0\"), module, nơi chứa và download_url, kèm can_edit=false và readonly=true. " +
			"Mỗi request chạy lại cổng đọc của nơi chứa theo người dùng của token; tệp đổi định dạng hoặc mất quyền đọc trả 404 như tệp không tồn tại. " +
			"Token tài liệu (oft1.), token phiên và ?sig= đều bị từ chối 401.",
		tags: []string{"documents"}, sdo: sdo.OfficeFrameSourceSDO{}, auth: true,
	})
	f.Get("/office-frame/sources/{sourceFileID}/content", h.GetOfficeFrameSourceContent, apiOp{
		summary: "Stream the source file bytes to the frame",
		description: "Chỉ token nguồn: bytes của tệp nguồn sau khi chạy lại cổng đọc. Content-Type theo MIME của nguồn, nosniff, " +
			"Cache-Control: private, no-store, Content-Security-Policy: sandbox; default-src 'none'. Content-Length chỉ đặt khi biết độ dài giải mã (email: độ dài đã mã hoá nên bỏ trống). Không hỗ trợ Range.",
		tags: []string{"documents"}, produces: "application/octet-stream", auth: true,
	})
	f.r.Head("/office-frame/sources/{sourceFileID}/content", h.GetOfficeFrameSourceContent)
	f.cat.add(http.MethodHead, joinRoute(f.prefix, "/office-frame/sources/{sourceFileID}/content"), apiOp{
		summary:     "Headers of the source file bytes",
		description: "Như GET nhưng không có body. Chỉ chạy phần tra cứu (không đọc byte): Content-Length vắng khi độ dài giải mã không biết (email).",
		tags:        []string{"documents"},
	})
}
