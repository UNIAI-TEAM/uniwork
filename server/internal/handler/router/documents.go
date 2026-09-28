package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// tag: documents — C-01 §5 + §14; UNI-679, G1-05a. Every route sits behind
// the `documents` flag (default off -> 404 feature_disabled). The byte routes
// also serve HEAD; the api wrapper has no Head method, so HEAD is bound on
// the inner chi router and catalogued by hand, like the files proxy.
//
//	POST   /api/v1/workspaces/{workspaceID}/documents
//	POST   /api/v1/workspaces/{workspaceID}/documents/files
//	GET    /api/v1/documents/{documentID}
//	PATCH  /api/v1/documents/{documentID}
//	GET    /api/v1/documents/{documentID}/download          (?meta=1 | bytes; HEAD)
//	POST   /api/v1/documents/{documentID}/uploads
//	POST   /api/v1/documents/{documentID}/versions/commit
//	GET    /api/v1/documents/{documentID}/versions
//	POST   /api/v1/documents/{documentID}/versions
//	GET    /api/v1/documents/{documentID}/versions/{versionNo}
//	POST   /api/v1/documents/{documentID}/versions/{versionNo}/restore
//	POST   /api/v1/documents/{documentID}/assets
//	GET    /api/v1/documents/{documentID}/assets/{assetID}  (HEAD)
//
//	GET    /api/v1/documents/{documentID}/comments
//	POST   /api/v1/documents/{documentID}/comments
//	PATCH  /api/v1/documents/{documentID}/comments/{commentID}
//	DELETE /api/v1/documents/{documentID}/comments/{commentID}
//	POST   /api/v1/documents/{documentID}/comments/{commentID}/resolve
//	DELETE /api/v1/documents/{documentID}/comments/{commentID}/resolve
//	POST   /api/v1/documents/{documentID}/comments/{commentID}/reactions
//	DELETE /api/v1/documents/{documentID}/comments/{commentID}/reactions
//	POST   /api/v1/documents/{documentID}/favorite
//	DELETE /api/v1/documents/{documentID}/favorite
//	GET    /api/v1/orgs/{orgID}/documents/favorites
func registerDocuments(r api, h Routes, flags *featureflag.Service) {
	d := r.With(mw.RequireFeatureFlag(flags, "documents"))

	d.Post("/workspaces/{workspaceID}/documents", h.CreateDocument, apiOp{
		summary: "Create a page document",
		description: "Tạo trang trong workspace. Body JSON (≤ 2 MiB content + envelope): title, kind=page, parent_id, icon, content ProseMirror {type:\"doc\"} (server sanitize), visibility workspace|restricted. " +
			"Idempotency-Key ràng create với fingerprint payload: replay trả lại trang đã tạo, payload khác cùng key -> 409 idempotency_payload_mismatch.",
		tags:   []string{"documents"},
		sdi:    sdi.CreateDocumentSDI{},
		sdo:    sdo.DocumentSDO{},
		status: http.StatusCreated,
		auth:   true,
	})
	d.Post("/workspaces/{workspaceID}/documents/files", h.CreateDocumentFile, apiOp{
		summary: "Create a file document",
		description: "Tạo document kiểu file bằng một request multipart: phần file stream vào FileService (purpose document_file, ≤ 50 MiB, MIME allowlist + magic bytes), parent_id/title là form field tùy chọn. " +
			"Idempotency-Key cho retry an toàn. Bytes đến nguyên vẹn; kích thước/checksum do server đo, client không tự khai.",
		tags:   []string{"documents"},
		sdi:    sdi.CreateDocumentFileSDI{},
		sdo:    sdo.DocumentSDO{},
		status: http.StatusCreated,
		auth:   true,
	})
	d.Get("/documents/{documentID}", h.GetDocument, apiOp{
		summary:     "Get a document",
		description: "Bản đang làm việc của page (content ProseMirror đã sanitize) hoặc mô tả file document kèm block file của version hiện tại. Revision là chuỗi thập phân. Cần quyền xem.",
		tags:        []string{"documents"},
		sdo:         sdo.DocumentSDO{},
		auth:        true,
	})
	d.Patch("/documents/{documentID}", h.PatchDocument, apiOp{
		summary: "Update a document",
		description: "Autosave/metadata của working copy. revision bắt buộc (chuỗi thập phân của base client thấy); base cũ -> 422 revision_conflict kèm fields.current_revision. " +
			"Field nil giữ nguyên; icon rỗng xóa icon; content thay thế working copy sau khi sanitize.",
		tags: []string{"documents"},
		sdi:  sdi.PatchDocumentSDI{},
		sdo:  sdo.DocumentSDO{},
		auth: true,
	})
	d.Post("/documents/{documentID}/uploads", h.UploadDocumentFile, apiOp{
		summary: "Stage bytes for a file version",
		description: "Multipart (một phần file, ≤ 50 MiB): giai đoạn bytes của candidate version. Trả upload_id (= file_id), checksum_sha256 server đo, size_bytes, claim_expires_at (~24h). " +
			"Commit bằng POST /documents/{id}/versions/commit với {upload_id, base_revision}. Idempotency-Key dẫn xuất key FileService: retry tìm lại cùng upload, không lưu bytes hai lần.",
		tags:   []string{"documents"},
		sdi:    sdi.UploadDocumentFileSDI{},
		sdo:    sdo.DocumentUploadSDO{},
		status: http.StatusCreated,
		auth:   true,
	})
	d.Post("/documents/{documentID}/versions/commit", h.CommitDocumentVersion, apiOp{
		summary: "Commit a staged file version",
		description: "Hình thức save duy nhất của file document (C-01 §14): {upload_id, base_revision} + Idempotency-Key. Server kiểm quyền, claim upload, quota, rồi append version mới (restored_from/engine được service gán). " +
			"Office engine (G2-02) dùng cùng endpoint với file_id từ RegisterProviderOutput. Replay cùng key trả kết quả đã lưu; base_revision cũ -> 422 revision_conflict.",
		tags: []string{"documents"},
		sdi:  sdi.CommitDocumentVersionSDI{},
		sdo:  sdo.DocumentVersionResultSDO{},
		auth: true,
	})
	d.Get("/documents/{documentID}/versions", h.ListDocumentVersions, apiOp{
		summary:     "List document versions",
		description: "Lịch sử version mới nhất trước, phân trang cursor (?cursor=&limit=). Version không mang content - lấy qua GET /versions/{versionNo} (page) hoặc download_url (file). Cần quyền xem.",
		tags:        []string{"documents"},
		sdi:         sdi.ListDocumentVersionsSDI{},
		sdo:         sdo.DocumentVersionListSDO{},
		auth:        true,
	})
	d.Post("/documents/{documentID}/versions", h.CreateDocumentVersion, apiOp{
		summary:     "Create a named page version",
		description: "Checkpoint thủ công của working copy page với label tùy chọn (≤ 200 ký tự). Không đổi so với version mới nhất -> 409 document_version_unchanged. Idempotency-Key replay trả version đã tạo.",
		tags:        []string{"documents"},
		sdi:         sdi.CreateDocumentVersionSDI{},
		sdo:         sdo.DocumentVersionSDO{},
		status:      http.StatusCreated,
		auth:        true,
	})
	d.Get("/documents/{documentID}/versions/{versionNo}", h.GetDocumentVersion, apiOp{
		summary:     "Get one document version",
		description: "Một version theo số thứ tự: page version mang content ProseMirror; file version mang file_id, snapshot mime/checksum/size và download_url proxy. Cần quyền xem.",
		tags:        []string{"documents"},
		sdo:         sdo.DocumentVersionSDO{},
		auth:        true,
	})
	d.Post("/documents/{documentID}/versions/{versionNo}/restore", h.RestoreDocumentVersion, apiOp{
		summary: "Restore a document version",
		description: "Append một version restore trỏ tới version cũ và cập nhật working copy. Body tùy chọn {base_revision}: page restore bỏ trống (ghi đè revision hiện tại); file restore bắt buộc base_revision client thấy, cũ -> 409 document_version_conflict. " +
			"Idempotency-Key replay trả kết quả đã lưu.",
		tags: []string{"documents"},
		sdi:  sdi.RestoreDocumentVersionSDI{},
		sdo:  sdo.DocumentVersionResultSDO{},
		auth: true,
	})
	d.Post("/documents/{documentID}/assets", h.UploadDocumentAsset, apiOp{
		summary: "Upload an embedded asset",
		description: "Multipart (một phần file, ≤ 10 MiB, image allowlist): asset page nhúng qua asset://{id} trong content. Trả url proxy đã xác thực /api/v1/documents/{id}/assets/{assetID}. " +
			"Document file không dùng route này - file bytes đi qua /uploads.",
		tags:   []string{"documents"},
		sdi:    sdi.UploadDocumentAssetSDI{},
		sdo:    sdo.DocumentAssetSDO{},
		status: http.StatusCreated,
		auth:   true,
	})
	d.Get("/documents/{documentID}/download", h.DownloadDocument, apiOp{
		summary: "Download a file document",
		description: "?meta=1 trả descriptor JSON {document_id, file, disposition}; ngược lại stream bytes của version hiện tại (hoặc ?version=N). " +
			"Luôn Content-Disposition: attachment. Hỗ trợ HEAD, Range (206), 416 kèm Content-Range: bytes */size, X-Checksum-Sha256. Page document -> 400/422 theo spec.",
		tags: []string{"documents"},
		sdi:  sdi.DownloadDocumentSDI{},
		sdo:  sdo.DocumentDownloadSDO{},
		auth: true,
	})
	d.r.Head("/documents/{documentID}/download", h.DownloadDocument)
	d.cat.add(http.MethodHead, joinRoute(d.prefix, "/documents/{documentID}/download"), apiOp{
		summary:     "Headers of a document download",
		description: "Như GET nhưng không có body: Content-Length, Content-Type, Accept-Ranges, Content-Range khi có Range, X-Checksum-Sha256. Kiểm quyền giống GET.",
		tags:        []string{"documents"},
	})
	d.Get("/documents/{documentID}/assets/{assetID}", h.GetDocumentAsset, apiOp{
		summary: "Stream a document asset",
		description: "Proxy xác thực cho asset://{id} trong content page. Kiểm quyền xem document mỗi request. MIME trong allowlist render inline, còn lại attachment. " +
			"Hỗ trợ HEAD, Range (206), 416 kèm Content-Range: bytes */size. Cache-Control: private, no-store.",
		tags:     []string{"documents"},
		produces: "application/octet-stream",
		auth:     true,
	})
	d.r.Head("/documents/{documentID}/assets/{assetID}", h.GetDocumentAsset)
	d.cat.add(http.MethodHead, joinRoute(d.prefix, "/documents/{documentID}/assets/{assetID}"), apiOp{
		summary:     "Headers of a document asset",
		description: "Như GET nhưng không có body: Content-Length, Content-Type, Accept-Ranges, Content-Range khi có Range. Kiểm quyền giống GET.",
		tags:        []string{"documents"},
	})

	// Comments and favorites (G1-07, UNI-681; lane 07b). One contiguous,
	// additive block: every route sits behind the same `documents` flag as
	// the block above, reads need view, writes need edit (favorites: view,
	// the caller's own bookmark), and comment edit/delete is author-or-manage
	// in the service. G2-07a registers its office routes separately.
	d.Get("/documents/{documentID}/comments", h.ListDocumentComments, apiOp{
		summary:     "List document comments",
		description: "Bình luận của tài liệu, cũ nhất trước, mỗi dòng kèm reactions. Cần quyền xem.",
		tags:        []string{"documents"},
		sdo:         sdo.DocumentCommentListSDO{},
		auth:        true,
	})
	d.Post("/documents/{documentID}/comments", h.CreateDocumentComment, apiOp{
		summary: "Add a document comment",
		description: "Thêm bình luận (hoặc trả lời qua parent_id cùng tài liệu) - cần quyền sửa. type chỉ nhận comment: client công khai không tạo được bình luận hệ thống. " +
			"Idempotency-Key ràng create với fingerprint payload: replay trả lại bình luận đã tạo, payload khác cùng key -> 409 idempotency_payload_mismatch.",
		tags: []string{"documents"},
		sdi:  sdi.CreateDocumentCommentSDI{},
		sdo:  sdo.DocumentCommentSDO{},
		auth: true,
	})
	d.Patch("/documents/{documentID}/comments/{commentID}", h.UpdateDocumentComment, apiOp{
		summary:     "Update a document comment",
		description: "Sửa nội dung bình luận: tác giả hoặc người có quyền manage, và vẫn phải còn quyền sửa trên tài liệu.",
		tags:        []string{"documents"},
		sdi:         sdi.UpdateDocumentCommentSDI{},
		sdo:         sdo.DocumentCommentSDO{},
		auth:        true,
	})
	d.Delete("/documents/{documentID}/comments/{commentID}", h.DeleteDocumentComment, apiOp{
		summary:     "Delete a document comment",
		description: "Xóa bình luận kèm reactions của nó: tác giả hoặc người có quyền manage.",
		tags:        []string{"documents"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	d.Post("/documents/{documentID}/comments/{commentID}/resolve", h.ResolveDocumentComment, apiOp{
		summary:     "Resolve a document comment",
		description: "Đánh dấu bình luận đã giải quyết (cần quyền sửa; idempotent).",
		tags:        []string{"documents"},
		sdo:         sdo.DocumentCommentSDO{},
		auth:        true,
	})
	d.Delete("/documents/{documentID}/comments/{commentID}/resolve", h.ReopenDocumentComment, apiOp{
		summary:     "Reopen a document comment",
		description: "Bỏ đánh dấu giải quyết, mở lại bình luận (cần quyền sửa; idempotent).",
		tags:        []string{"documents"},
		sdo:         sdo.DocumentCommentSDO{},
		auth:        true,
	})
	d.Post("/documents/{documentID}/comments/{commentID}/reactions", h.AddDocumentCommentReaction, apiOp{
		summary:     "Add a document comment reaction",
		description: "Thêm emoji lên bình luận (cần quyền sửa; cùng emoji cùng người = một dòng).",
		tags:        []string{"documents"},
		sdi:         sdi.ReactionSDI{},
		sdo:         sdo.CommentReactionSDO{},
		auth:        true,
	})
	d.Delete("/documents/{documentID}/comments/{commentID}/reactions", h.RemoveDocumentCommentReaction, apiOp{
		summary:     "Remove a document comment reaction",
		description: "Gỡ emoji của chính người gọi khỏi bình luận (cần quyền sửa; idempotent).",
		tags:        []string{"documents"},
		sdi:         sdi.ReactionSDI{},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	d.Post("/documents/{documentID}/favorite", h.FavoriteDocument, apiOp{
		summary:     "Favorite a document",
		description: "Lưu tài liệu vào danh sách yêu thích của người gọi (cần quyền xem; idempotent - gọi lại trả về dòng đang có).",
		tags:        []string{"documents"},
		sdo:         sdo.DocumentFavoriteSDO{},
		auth:        true,
	})
	d.Delete("/documents/{documentID}/favorite", h.UnfavoriteDocument, apiOp{
		summary:     "Unfavorite a document",
		description: "Bỏ tài liệu khỏi danh sách yêu thích (cần quyền xem; idempotent - chưa lưu vẫn trả 200).",
		tags:        []string{"documents"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	d.Get("/orgs/{orgID}/documents/favorites", h.ListDocumentFavorites, apiOp{
		summary:     "List my favorite documents",
		description: "Tài liệu người gọi đã lưu trong một tổ chức, mới nhất trước; mỗi dòng kiểm lại quyền đọc hiện tại nên chia sẻ bị thu hồi tự rụng khỏi danh sách. Không phải thành viên -> 404.",
		tags:        []string{"documents"},
		sdo:         sdo.DocumentFavoriteListSDO{},
		auth:        true,
	})
}
