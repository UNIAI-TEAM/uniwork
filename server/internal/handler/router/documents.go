package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// tag: documents — C-01 §5 + §14; UNI-679, G1-05a/G1-05b. Authenticated
// routes sit behind the `documents` flag (default off -> 404
// feature_disabled). The byte routes also serve HEAD; the api wrapper has no
// Head method, so HEAD is bound on the inner chi router and catalogued by
// hand, like the files proxy. The public link routes (registerPublicDocuments)
// are unauthenticated and evaluate the flag at the document's own
// organization inside the handler.
//
//	POST   /api/v1/workspaces/{workspaceID}/documents
//	POST   /api/v1/workspaces/{workspaceID}/documents/files
//	GET    /api/v1/workspaces/{workspaceID}/documents              (G1-05b)
//	GET    /api/v1/workspaces/{workspaceID}/documents/recent       (G1-05b)
//	GET    /api/v1/workspaces/{workspaceID}/documents/shared-with-me (G1-05b)
//	GET    /api/v1/workspaces/{workspaceID}/documents/tree         (G1-05b)
//	GET    /api/v1/documents/{documentID}
//	PATCH  /api/v1/documents/{documentID}
//	POST   /api/v1/documents/{documentID}/move                    (G1-05b)
//	POST   /api/v1/documents/{documentID}/archive                 (G1-05b)
//	POST   /api/v1/documents/{documentID}/restore                 (G1-05b)
//	GET    /api/v1/documents/{documentID}/shares                  (G1-05b)
//	POST   /api/v1/documents/{documentID}/shares                  (G1-05b)
//	DELETE /api/v1/documents/{documentID}/shares/{shareID}        (G1-05b)
//	POST   /api/v1/documents/{documentID}/links                   (G1-05b)
//	DELETE /api/v1/documents/{documentID}/links/{linkID}          (G1-05b)
//	GET    /api/v1/documents/{documentID}/access-logs             (G1-05b)
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
//	PUT    /api/v1/orgs/{orgID}/documents/settings                (G1-05b)
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
	// Office (plan G2-07 / UNI-690; C-01 §6.2). The routes carry document
	// authority: capability and job status need view, starting and cancelling
	// a job need edit, and the client never learns an engine address - only
	// the engine's pinned identity. Export/convert answer
	// unsupported_operation until an engine lane binds a converter (Q7).
	d.Get("/documents/{documentID}/office/capabilities", h.OfficeCapability, apiOp{
		summary: "List the Office capabilities of a document",
		description: "Hàng capability của engine cho định dạng của tài liệu, cộng hàng create_blank: supported = engine bind và đã có bằng chứng sản phẩm; " +
			"false thì UI ẩn hành động. Cần quyền xem. Engine chưa cấu hình -> 503 office_not_configured.",
		tags: []string{"documents"},
		sdo:  sdo.OfficeCapabilitySDO{},
		auth: true,
	})
	d.Post("/documents/{documentID}/office/jobs", h.StartOfficeJob, apiOp{
		summary: "Start an Office job",
		description: "Operation trong allowlist open|serialize|export|convert + Idempotency-Key. Base version/revision và định dạng lấy từ tài liệu, client không gửi version id. " +
			"Version negotiation và operation gate chạy TRƯỚC khi ghi: engine/contract/protocol lệch pin -> 409 engine_incompatible|contract_mismatch|protocol_mismatch; " +
			"thao tác chưa bind -> 501 unsupported_operation. Job completed chưa phải version: commit bằng /versions/commit với upload_id = output_file_id.",
		tags:   []string{"documents"},
		sdi:    sdi.StartOfficeJobSDI{},
		sdo:    sdo.OfficeJobSDO{},
		status: http.StatusCreated,
		auth:   true,
	})
	d.Get("/documents/{documentID}/office/jobs/{jobID}", h.GetOfficeJob, apiOp{
		summary:     "Get an Office job",
		description: "Trạng thái job (accepted/running/completed/failed/timed_out/cancelled/crashed) kèm output file_id/checksum và lỗi có kiểu. Cần quyền xem; job của tài liệu khác -> 404.",
		tags:        []string{"documents"},
		sdo:         sdo.OfficeJobSDO{},
		auth:        true,
	})
	d.Post("/documents/{documentID}/office/jobs/{jobID}/cancel", h.CancelOfficeJob, apiOp{
		summary:     "Cancel an Office job",
		description: "Chỉ người tạo job huỷ được. Cancel thắng cho tới khi output được claim vào một version; job đã kết thúc trả về trạng thái thật của nó. Cần quyền sửa.",
		tags:        []string{"documents"},
		sdo:         sdo.OfficeJobSDO{},
		auth:        true,
	})
	d.Post("/workspaces/{workspaceID}/documents/files/blank", h.CreateBlankDocumentFile, apiOp{
		summary: "Create a blank file document",
		description: "Tạo tài liệu mới với bytes do engine sinh: server chọn seed, engine serialize, FileService xác minh, rồi đường create G1 tạo document + version 1. " +
			"Chỉ định dạng có blank generator (md, html) được nhận; định dạng khác -> 501 unsupported_operation và KHÔNG tạo file Office rỗng. Idempotency-Key replay trả tài liệu đã tạo.",
		tags:   []string{"documents"},
		sdi:    sdi.CreateBlankDocumentFileSDI{},
		sdo:    sdo.DocumentSDO{},
		status: http.StatusCreated,
		auth:   true,
	})
	d.Post("/documents/{documentID}/copies", h.CopyDocument, apiOp{
		summary: "Copy a document",
		description: "Bản sao standalone: consent phải là \"copy\" (thiếu -> 409 copy_consent_required). Cần quyền sửa nguồn. Bản sao giữ acl_owner_id/visibility/share của nguồn " +
			"và ghi provenance (source_document_id/version/revision/checksum/format); bytes dùng lại đúng file_id nên không tính dung lượng lần hai. Tài liệu thuộc sở hữu C-14 -> 409 owner_requires_copy.",
		tags:   []string{"documents"},
		sdi:    sdi.CopyDocumentSDI{},
		sdo:    sdo.DocumentSDO{},
		status: http.StatusCreated,
		auth:   true,
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

	// ---- G1-05b (UNI-679, C-01 §5.1/§5.3/§5.4): collections, tree,
	// lifecycle, sharing, access log and the org public-links switch. One
	// contiguous block so the parallel comment/office lanes merge cleanly.
	d.Get("/workspaces/{workspaceID}/documents", h.ListDocuments, apiOp{
		summary:     "List documents",
		description: "Danh sách tài liệu workspace, mới sửa trước. parent_id = một cấp cây theo position; q = tìm toàn workspace kèm snippet; kind/archived/updated_by/updated_from/updated_to là filter. Quyền được lọc trong query trước limit nên cursor ổn định; archived=1 chỉ manage.",
		tags:        []string{"documents"},
		sdi:         sdi.ListDocumentsSDI{},
		sdo:         sdo.DocumentListSDO{},
		auth:        true,
	})
	d.Get("/workspaces/{workspaceID}/documents/recent", h.ListRecentDocuments, apiOp{
		summary:     "List recent documents",
		description: "Tài liệu người dùng đã mở (access log) hoặc sửa gần đây, lọc quyền trước limit, cursor ổn định. Agent không có \"gần đây\" -> 403.",
		tags:        []string{"documents"},
		sdi:         sdi.ListRecentDocumentsSDI{},
		sdo:         sdo.DocumentListSDO{},
		auth:        true,
	})
	d.Get("/workspaces/{workspaceID}/documents/shared-with-me", h.ListSharedWithMe, apiOp{
		summary:     "List documents shared with me",
		description: "Tài liệu người gọi nhận qua share, gồm workspace khác trong tổ chức; một share đã thu hồi hoặc không còn hiệu lực sẽ biến mất. Duyệt ứng viên bằng keyset và lọc quyền trước khi xếp trang nên ứng viên bị từ chối không chiếm suất; cursor ổn định như các list khác. Workspace trên URL là ngữ cảnh thành viên, danh sách trải theo tổ chức.",
		tags:        []string{"documents"},
		sdi:         sdi.ListSharedWithMeSDI{},
		sdo:         sdo.DocumentListSDO{},
		auth:        true,
	})
	d.Get("/workspaces/{workspaceID}/documents/tree", h.DocumentTree, apiOp{
		summary:     "Read the document tree",
		description: "Cây sidebar tối đa 5 cấp, chỉ metadata {id,title,icon,kind,position,children}; root chọn một nhánh. Node dưới tổ tiên không đọc được sẽ rời cây cùng tổ tiên; root không đọc được -> 404.",
		tags:        []string{"documents"},
		sdi:         sdi.DocumentTreeSDI{},
		sdo:         sdo.DocumentTreeSDO{},
		auth:        true,
	})
	d.Post("/documents/{documentID}/move", h.MoveDocument, apiOp{
		summary:     "Move a document",
		description: "Đổi cha/thứ tự trong cùng workspace. Kiểm edit cả nguồn lẫn đích; chu trình -> 422 document_cycle, quá 5 cấp -> 422 document_too_deep, khác workspace -> 422 cross_workspace_reference; tài liệu thuộc Work Product -> 409. Idempotency-Key replay an toàn.",
		tags:        []string{"documents"},
		sdi:         sdi.MoveDocumentSDI{},
		sdo:         sdo.DocumentSDO{},
		auth:        true,
	})
	d.Post("/documents/{documentID}/archive", h.ArchiveDocument, apiOp{
		summary:     "Archive a document subtree",
		description: "Đưa tài liệu và cả cây con vào thùng rác trong một transaction sau khi kiểm manage trên từng node sống; node restricted không manage được sẽ chặn cả lệnh. Idempotency-Key replay trả kết quả đã lưu.",
		tags:        []string{"documents"},
		sdo:         sdo.DocumentArchiveSDO{},
		auth:        true,
	})
	d.Post("/documents/{documentID}/restore", h.RestoreDocument, apiOp{
		summary:     "Restore an archived document",
		description: "Khôi phục đúng các node của một đợt archive (batch_id); node bị archive bởi đợt khác không tự sống lại. Idempotency-Key replay trả kết quả đã lưu.",
		tags:        []string{"documents"},
		sdo:         sdo.DocumentArchiveSDO{},
		auth:        true,
	})
	d.Get("/documents/{documentID}/shares", h.ListDocumentShares, apiOp{
		summary:     "List document access",
		description: "Người gọi luôn thấy my_level/via của mình; chỉ manage thấy acl_owner, danh sách grant sống (kèm effective_level) và liên kết công khai sống. Grant đã thu hồi không xuất hiện.",
		tags:        []string{"documents"},
		sdo:         sdo.DocumentAccessSDO{},
		auth:        true,
	})
	d.Post("/documents/{documentID}/shares", h.CreateDocumentShare, apiOp{
		summary:     "Share a document",
		description: "Cấp view/edit/manage cho user, workspace hoặc organization cùng tổ chức; principal ngoài tổ chức -> 422 principal_not_in_organization. Trùng principal sống thì grant cũ bị thu hồi và thay trong cùng transaction. Chỉ manage; tài liệu thuộc Work Product -> 409.",
		tags:        []string{"documents"},
		sdi:         sdi.ShareDocumentSDI{},
		sdo:         sdo.DocumentShareSDO{},
		status:      http.StatusCreated,
		auth:        true,
	})
	d.Delete("/documents/{documentID}/shares/{shareID}", h.RevokeDocumentShare, apiOp{
		summary:     "Revoke a document share",
		description: "Thu hồi một grant đang sống (ghi revoked_at, giữ lịch sử). Chỉ manage; share không thuộc tài liệu -> 404.",
		tags:        []string{"documents"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	d.Post("/documents/{documentID}/links", h.CreateDocumentLink, apiOp{
		summary:     "Create a public link",
		description: "Liên kết xem ẩn danh: cần entitlement documents.public_links và công tắc tổ chức; tối đa 5 liên kết sống -> 422 document_link_limit. Token chỉ trả một lần cùng url trang chia sẻ; server chỉ giữ SHA-256.",
		tags:        []string{"documents"},
		sdi:         sdi.CreateDocumentLinkSDI{},
		sdo:         sdo.DocumentLinkSDO{},
		status:      http.StatusCreated,
		auth:        true,
	})
	d.Delete("/documents/{documentID}/links/{linkID}", h.RevokeDocumentLink, apiOp{
		summary:     "Revoke a public link",
		description: "Thu hồi liên kết; lần đọc công khai kế tiếp bằng token đó là 404. Chỉ manage.",
		tags:        []string{"documents"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	d.Get("/documents/{documentID}/access-logs", h.ListDocumentAccessLogs, apiOp{
		summary:     "List the document access log",
		description: "Nhật ký truy cập mới nhất trước (view/download/export/link_view), lọc theo action, cursor ổn định; actor human/agent được resolve tên/avatar, anonymous không có block actor. Chỉ manage.",
		tags:        []string{"documents"},
		sdi:         sdi.ListDocumentAccessLogsSDI{},
		sdo:         sdo.DocumentAccessLogListSDO{},
		auth:        true,
	})
	d.Put("/orgs/{orgID}/documents/settings", h.SetDocumentSettings, apiOp{
		summary:     "Set the organization public-link switch",
		description: "Bật/tắt liên kết công khai cho tổ chức. Chỉ owner/admin tổ chức; tắt sẽ đóng mọi liên kết sống ngay lần đọc kế tiếp mà không thu hồi chúng.",
		tags:        []string{"documents"},
		sdi:         sdi.SetDocumentSettingsSDI{},
		sdo:         sdo.DocumentSettingsSDO{},
		auth:        true,
	})
}

// registerPublicDocuments binds the anonymous link routes. They are NOT
// behind RequireFeatureFlag: there is no caller organization to evaluate, so
// the handler checks the flag on the document's own organization after the
// token resolves. The IP-keyed limiter is the same middleware the other
// public routes use. GET and HEAD share one handler; the api wrapper has no
// Head method, so HEAD is catalogued by hand.
//
//	GET /api/v1/public/documents/{token}                  (JSON view)
//	GET /api/v1/public/documents/{token}/download         (bytes; HEAD)
//	GET /api/v1/public/documents/{token}/assets/{assetID} (bytes; HEAD)
func registerPublicDocuments(r api, h Routes, limiter func(http.Handler) http.Handler) {
	p := r.With(limiter)
	p.Get("/public/documents/{token}", h.GetPublicDocument, apiOp{
		summary:     "View a publicly shared document",
		description: "Không cần đăng nhập: token là credential duy nhất. Trả title + content đã sanitize (page) hoặc download_url (file); link hết hạn/thu hồi, organization tắt liên kết hoặc feature flag documents của tổ chức tắt -> 404 giống hệt token lạ.",
		tags:        []string{"documents"},
		sdo:         sdo.PublicDocumentSDO{},
		auth:        false,
	})
	p.Get("/public/documents/{token}/download", h.DownloadPublicDocument, apiOp{
		summary:     "Download a publicly shared file",
		description: "Stream byte của bản file hiện hành qua Go (không presign), hỗ trợ HEAD/Range (206/416), luôn Content-Disposition: attachment; mỗi lần đọc kiểm lại link, organization và flag.",
		tags:        []string{"documents"},
		produces:    "application/octet-stream",
		auth:        false,
	})
	p.r.Head("/public/documents/{token}/download", h.DownloadPublicDocument)
	p.cat.add(http.MethodHead, joinRoute(p.prefix, "/public/documents/{token}/download"), apiOp{
		summary:     "Headers of a public file download",
		description: "Như GET nhưng không có body: Content-Length, Content-Type, Accept-Ranges, Content-Range khi có Range. Kiểm link và flag giống GET.",
		tags:        []string{"documents"},
	})
	p.Get("/public/documents/{token}/assets/{assetID}", h.GetPublicDocumentAsset, apiOp{
		summary:     "Stream a publicly shared page asset",
		description: "Asset của đúng tài liệu sau link; ảnh trong allowlist render inline, còn lại attachment. Hỗ trợ HEAD/Range; mỗi lần đọc kiểm lại link, organization và flag.",
		tags:        []string{"documents"},
		produces:    "application/octet-stream",
		auth:        false,
	})
	p.r.Head("/public/documents/{token}/assets/{assetID}", h.GetPublicDocumentAsset)
	p.cat.add(http.MethodHead, joinRoute(p.prefix, "/public/documents/{token}/assets/{assetID}"), apiOp{
		summary:     "Headers of a public asset",
		description: "Như GET nhưng không có body: Content-Length, Content-Type, Accept-Ranges, Content-Range khi có Range. Kiểm link và flag giống GET.",
		tags:        []string{"documents"},
	})
}
