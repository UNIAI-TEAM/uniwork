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
// feature_disabled), evaluated at the organization the path acts in
// (mw.FlagOrganization, UNI-1800). The byte routes also serve HEAD; the api wrapper has no
// Head method, so HEAD is bound on the inner chi router and catalogued by
// hand, like the files proxy. The public link routes (registerPublicDocuments)
// are unauthenticated and evaluate the flag at the document's own
// organization inside the handler.
//
//	POST   /api/v1/workspaces/{workspaceID}/documents
//	POST   /api/v1/workspaces/{workspaceID}/documents/files
//	GET    /api/v1/workspaces/{workspaceID}/documents              (G1-05b)
//	GET    /api/v1/workspaces/{workspaceID}/documents/recent       (G1-05b)
//	GET    /api/v1/workspaces/{workspaceID}/documents/changes      (G5-01a)
//	GET    /api/v1/workspaces/{workspaceID}/documents/shared-with-me (G1-05b)
//	GET    /api/v1/workspaces/{workspaceID}/documents/tree         (G1-05b)
//	GET    /api/v1/documents/{documentID}
//	PATCH  /api/v1/documents/{documentID}
//	POST   /api/v1/documents/{documentID}/move                    (G1-05b)
//	POST   /api/v1/documents/{documentID}/archive                 (G1-05b)
//	GET    /api/v1/documents/{documentID}/archive-impact          (FD-04)
//	POST   /api/v1/documents/{documentID}/restore                 (G1-05b)
//	GET    /api/v1/documents/{documentID}/shares                  (G1-05b)
//	POST   /api/v1/documents/{documentID}/shares                  (G1-05b)
//	POST   /api/v1/documents/{documentID}/shares/batch            (UNI-1641)
//	DELETE /api/v1/documents/{documentID}/shares/{shareID}        (G1-05b)
//	POST   /api/v1/documents/{documentID}/break-glass             (DOC-05)
//	DELETE /api/v1/documents/{documentID}/break-glass/{grantID}   (DOC-05)
//	GET    /api/v1/documents/{documentID}/admin-summary           (DOC-05)
//	POST   /api/v1/documents/{documentID}/links                   (G1-05b)
//	DELETE /api/v1/documents/{documentID}/links/{linkID}          (G1-05b)
//	GET    /api/v1/documents/{documentID}/access-logs             (G1-05b)
//	PUT    /api/v1/documents/{documentID}/office/offline-lease    (G5-08s)
//	DELETE /api/v1/documents/{documentID}/office/offline-lease    (G5-08s)
//	GET    /api/v1/documents/{documentID}/edit-lock                         (UNI-1645 R1)
//	POST   /api/v1/documents/{documentID}/edit-lock                         (R2)
//	POST   /api/v1/documents/{documentID}/edit-lock/{lockID}/heartbeat      (R3)
//	DELETE /api/v1/documents/{documentID}/edit-lock/{lockID}                (R4)
//	POST   /api/v1/documents/{documentID}/edit-lock/take-over               (R5)
//	PUT    /api/v1/documents/{documentID}/edit-lock/{lockID}/offline-hold   (R6)
//	DELETE /api/v1/documents/{documentID}/edit-lock/{lockID}/offline-hold   (R7)
//	POST   /api/v1/documents/{documentID}/edit-requests                     (R8)
//	POST   /api/v1/documents/{documentID}/edit-requests/{requestID}/answer  (R9)
//	DELETE /api/v1/documents/{documentID}/edit-requests/{requestID}         (R10)
//	GET    /api/v1/documents/{documentID}/download          (?meta=1 | bytes; HEAD)
//	POST   /api/v1/documents/{documentID}/uploads
//	POST   /api/v1/documents/{documentID}/versions/commit
//	GET    /api/v1/documents/{documentID}/versions/commit       (G5-07, Idempotency-Key header)
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
//	GET    /api/v1/documents/{documentID}/comments/{commentID}/revisions   (G8-03)
//	PUT    /api/v1/documents/{documentID}/comments/anchors                 (G8-04)
//	POST   /api/v1/documents/{documentID}/comments/{commentID}/reactions
//	DELETE /api/v1/documents/{documentID}/comments/{commentID}/reactions
//	GET    /api/v1/documents/{documentID}/mention-candidates     (G8-06)
//	POST   /api/v1/documents/{documentID}/favorite
//	DELETE /api/v1/documents/{documentID}/favorite
//	GET    /api/v1/orgs/{orgID}/documents/favorites
//	PUT    /api/v1/orgs/{orgID}/documents/settings                (G1-05b)
//	GET    /api/v1/orgs/{orgID}/documents/settings                (G1-08)
func registerDocuments(r api, h Routes, flags *featureflag.Service, editRequestLimit func(http.Handler) http.Handler) {
	d := r.With(mw.RequireFeatureFlag(flags, "documents"))
	registerDocumentEditLock(d, h, editRequestLimit)

	d.Post("/workspaces/{workspaceID}/documents", h.CreateDocument, apiOp{
		summary: "Create a page or folder document",
		description: "Tạo trang hoặc thư mục trong workspace. Body JSON (≤ 2 MiB content + envelope): title, kind=page|folder, parent_id (trang/thư mục; thư mục chỉ nằm ở gốc hoặc trong thư mục, sai -> 422 document_parent_kind), thư mục không nhận content (-> 422 folder_not_supported), icon, content ProseMirror {type:\"doc\"} (server sanitize), visibility workspace|restricted. " +
			"Tài liệu mới ở gốc mặc định riêng tư (restricted); gửi workspace để mở dòng Workspace gốc ở mức Chỉ xem (nâng mức trong hộp Chia sẻ); bỏ trống dưới cha thì kế thừa cha (cả mức), ở gốc = restricted; giá trị khác -> 400 invalid_request. " +
			"Idempotency-Key ràng create với fingerprint payload: replay trả lại trang đã tạo, payload khác cùng key -> 409 idempotency_payload_mismatch.",
		tags:   []string{"documents"},
		sdi:    sdi.CreateDocumentSDI{},
		sdo:    sdo.DocumentSDO{},
		status: http.StatusCreated,
		auth:   true,
	})
	d.Post("/workspaces/{workspaceID}/documents/my-folder", h.EnsureMyFolder, apiOp{
		summary:     "Ensure the caller's personal My Folder",
		description: "Tạo lười và trả về thư mục gốc cá nhân (My Folder, system_kind=my_folder, visibility=restricted) của thành viên đang gọi trong workspace (MYFOLDER-01). Tự idempotent: lần đầu tạo hàng kèm audit/outbox document.created (metadata system_kind=my_folder), các lần sau trả lại cùng hàng và không ghi audit thêm; luôn trả 200 DocumentSDO, body rỗng.",
		tags:        []string{"documents"},
		sdo:         sdo.DocumentSDO{},
		status:      http.StatusOK,
		auth:        true,
	})
	d.Post("/workspaces/{workspaceID}/documents/files", h.CreateDocumentFile, apiOp{
		summary: "Create a file document",
		description: "Tạo document kiểu file bằng một request multipart: phần file stream vào FileService (purpose document_file, ≤ DOCUMENT_MAX_BYTES (mặc định 200 MiB), MIME allowlist + magic bytes), parent_id/title là form field tùy chọn. " +
			"Form field visibility (phải đứng trước phần file): workspace|restricted; tài liệu mới ở gốc mặc định riêng tư, gửi workspace để mở dòng Workspace gốc ở mức Chỉ xem, bỏ trống dưới cha thì kế thừa cha (cả mức), giá trị khác -> 400 invalid_request. " +
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
	d.Post("/documents/{documentID}/office/sessions", h.CreateOfficeLaunch, apiOp{
		summary:     "Create an Office launch ticket",
		description: "Explicit Document action: checks the live ACL, binds account/deployment/client/version and returns one opaque 120-second deep-link ticket. Historical versions are read-only.",
		tags:        []string{"documents"}, sdi: sdi.CreateOfficeLaunchSessionSDI{}, sdo: sdo.OfficeLaunchSessionSDO{}, status: http.StatusCreated, auth: true,
	})
	// Offline lease (G5-08s, decision G5-D1; DOC-005 §6.2). The device is the
	// bearer's own session (a browser session has none), never a body field;
	// the flag hides grant and renewal only, release always works.
	d.Put("/documents/{documentID}/office/offline-lease", h.PutOfficeOfflineLease, apiOp{
		summary: "Grant or renew an offline lease",
		description: "Cấp hoặc gia hạn lease offline của thiết bị desktop đang gọi cho một tài liệu file (G5-08s). Thiết bị lấy từ phiên bearer: phiên trình duyệt -> 403 offline_lease_device_required; thiết bị bị thu hồi/hết hạn -> 401 device_revoked. " +
			"Mỗi lần cấp/gia hạn chạy lại quyền sống (không đọc được -> 404, member_deactivated, organization_suspended), flag office_offline_library tắt -> 403 office_capability_off. " +
			"Gia hạn gửi lease đang giữ: chữ ký hỏng, hàng đã thu hồi/không còn hoặc policy epoch cũ -> 403 offline_lease_revoked; tài liệu đã lưu trữ -> 403 document_archived. Cấp mới quá 200 lease sống/thiết bị -> 409 offline_lease_limit_reached. " +
			"Hạn tối đa 24 giờ, không quá hạn phiên thiết bị; manage hạ xuống edit; lease phủ version head lúc cấp/gia hạn. Idempotent theo thiết bị: PUT không lease khi thiết bị đang giữ lease sống = gia hạn.",
		tags: []string{"documents"}, sdi: sdi.PutOfficeOfflineLeaseSDI{}, sdo: sdo.OfficeOfflineLeaseSDO{}, auth: true,
	})
	d.Delete("/documents/{documentID}/office/offline-lease", h.DeleteOfficeOfflineLease, apiOp{
		summary:     "Release an offline lease",
		description: "Thiết bị đang gọi trả lease offline của nó trên tài liệu (bỏ ghim). Chạy cả khi flag office_offline_library tắt và khi đã mất quyền đọc; không có lease mà đọc được tài liệu -> 200 (idempotent), không đọc được -> 404.",
		tags:        []string{"documents"}, sdo: sdo.StatusSDO{}, auth: true,
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
		description: "Multipart (một phần file, ≤ DOCUMENT_MAX_BYTES (mặc định 200 MiB)): giai đoạn bytes của candidate version. Trả upload_id (= file_id), checksum_sha256 server đo, size_bytes, claim_expires_at (~24h). " +
			"Commit bằng POST /documents/{id}/versions/commit với {upload_id, base_revision}; tài liệu đã lưu trữ -> 403 document_archived chỉ cho người có quyền sửa trở lên (dưới quyền sửa hoặc không xem được -> 404 not_found). Thứ tự từ chối: không xem được -> 404; đã lưu trữ -> 403 document_archived / 404; folder -> 422 folder_not_supported; không phải file -> 400 invalid_request; chỉ có quyền xem -> 403 forbidden. Idempotency-Key dẫn xuất key FileService: retry tìm lại cùng upload, không lưu bytes hai lần.",
		tags:   []string{"documents"},
		sdi:    sdi.UploadDocumentFileSDI{},
		sdo:    sdo.DocumentUploadSDO{},
		status: http.StatusCreated,
		auth:   true,
	})
	d.Post("/documents/{documentID}/versions/commit", h.CommitDocumentVersion, apiOp{
		summary: "Commit a staged file version",
		description: "Hình thức save duy nhất của file document (C-01 §14): {upload_id, base_revision} + Idempotency-Key. Server kiểm quyền, claim upload, quota, rồi append version mới (restored_from/engine được service gán). " +
			"Office engine (G2-02) dùng cùng endpoint với file_id từ RegisterProviderOutput. Replay cùng key trả kết quả đã lưu; tài liệu đã lưu trữ -> 403 document_archived chỉ cho người có quyền sửa trở lên (dưới quyền sửa hoặc không xem được -> 404 not_found); base_revision cũ -> 409 document_version_conflict.",
		tags: []string{"documents"},
		sdi:  sdi.CommitDocumentVersionSDI{},
		sdo:  sdo.DocumentVersionResultSDO{},
		auth: true,
	})
	d.Get("/documents/{documentID}/versions/commit", h.LookupCommitIntent, apiOp{
		summary: "Look up what became of a file version commit",
		description: "Tra intent commit theo header Idempotency-Key (bắt buộc; không đặt key vào URL): {outcome: committed (kèm version, revision) | in_flight (attempt đang giữ claim) | not_committed (claim hết hạn, không attempt nào còn commit được — an toàn để cấp attempt/key mới)}. " +
			"Key đã bị dọn sau cửa sổ resume, chưa từng tới server hoặc của người khác -> 410 commit_intent_unknown (không bao giờ giả not_committed). Cần quyền xem; vẫn trả lời khi office_sync_write tắt.",
		tags: []string{"documents"},
		sdo:  sdo.CommitIntentSDO{},
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
		description: "Append một version restore trỏ tới version cũ và cập nhật working copy. Body tùy chọn {base_revision}: page restore bỏ trống (ghi đè revision hiện tại); file restore bắt buộc base_revision client thấy, cũ -> 409 document_version_conflict, tài liệu file đã lưu trữ -> 403 document_archived cho người có quyền sửa trở lên (dưới quyền sửa -> 404 not_found). " +
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
	d.Post("/documents/{documentID}/preview/scopes", h.CreatePreviewScope, apiOp{
		summary:     "Create an isolated preview asset scope",
		description: "Mint a short-lived, document-bound capability for the separate preview origin. The frame receives no app cookie, bearer token or API bridge; only listed manifest asset ids are served.",
		tags:        []string{"documents"},
		sdi:         sdi.CreatePreviewScopeSDI{},
		sdo:         sdo.PreviewScopeSDO{},
		status:      http.StatusCreated,
		auth:        true,
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
	// the engine's pinned identity. Export answers unsupported_operation until
	// an engine lane binds it; convert (Q7, G2-07b) stages an OOXML copy that
	// POST .../copies with job_id accepts.
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
			"thao tác chưa bind -> 501 unsupported_operation. Job completed chưa phải version: commit bằng /versions/commit với upload_id = output_file_id. " +
			"convert (xls -> xlsx, odt -> docx) cần target_format; job completed mang result (fidelity + danh sách thay đổi), không commit vào nguồn: chấp nhận bằng /copies với job_id, huỷ bằng .../cancel.",
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
	d.Get("/documents/{documentID}/office/jobs/{jobID}/output", h.GetOfficeJobOutput, apiOp{
		summary:     "Download a completed Office job output",
		description: "Streams the staged output of a completed Office job for the document editor; the normal versions/commit route still owns persistence. Requires document view access.",
		tags:        []string{"documents"},
		produces:    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		auth:        true,
	})
	d.r.Head("/documents/{documentID}/office/jobs/{jobID}/output", h.GetOfficeJobOutput)
	d.cat.add(http.MethodHead, joinRoute(d.prefix, "/documents/{documentID}/office/jobs/{jobID}/output"), apiOp{
		summary:     "Headers of a completed Office job output",
		description: "Like GET without a body: Content-Length and Content-Type only. Same document view check as GET.",
		tags:        []string{"documents"},
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
			"Chỉ định dạng có blank generator (md, html, xlsx, docx, pptx, pdf) được nhận; docx/pptx là gói OOXML tối thiểu server tạo sẵn (1 đoạn trống / 1 slide 16:9 trống), pdf là 1 trang A4 trống; định dạng khác -> 501 unsupported_operation và KHÔNG tạo file Office rỗng. " +
			"visibility workspace|restricted: tài liệu mới ở gốc mặc định riêng tư, gửi workspace để mở dòng Workspace gốc ở mức Chỉ xem, bỏ trống dưới cha thì kế thừa cha (cả mức), giá trị khác -> 400 invalid_request. Idempotency-Key replay trả tài liệu đã tạo.",
		tags:   []string{"documents"},
		sdi:    sdi.CreateBlankDocumentFileSDI{},
		sdo:    sdo.DocumentSDO{},
		status: http.StatusCreated,
		auth:   true,
	})
	d.Post("/documents/{documentID}/copies", h.CopyDocument, apiOp{
		summary: "Copy a document",
		description: "Bản sao standalone: consent phải là \"copy\" (thiếu -> 409 copy_consent_required). Cần quyền sửa nguồn. Bản sao giữ acl_owner_id/visibility/share của nguồn " +
			"và ghi provenance (source_document_id/version/revision/checksum/format); bytes dùng lại đúng file_id nên không tính dung lượng lần hai. Tài liệu thuộc sở hữu C-14 -> 409 owner_requires_copy. " +
			"Bản sao là một lần tạo trong workspace của nguồn nên cần chỗ thành viên ở đó: người chỉ sửa được nguồn qua chia sẻ/liên kết -> 403 workspace_seat_required (kể cả khi chấp nhận job); không sửa được thư mục cha -> 403 forbidden; tổ chức tạm ngưng/thành viên bị vô hiệu hóa giữ organization_suspended/member_deactivated. " +
			"Có job_id: chấp nhận job convert đã completed (chỉ người tạo job) - bản sao là output OOXML, provenance ghi checksum nguồn + engine; job huỷ/đã chấp nhận -> 409 conversion_not_accepted; nguồn và lịch sử không đổi. " +
			"Có upload_id (loại trừ lẫn nhau với job_id -> 400 invalid_request): phiên bản đầu của bản sao lấy từ bản tải lên đã stage của chính tài liệu này bởi cùng người gọi (khác tài liệu/người gọi/tổ chức -> 404 not_found; đã dùng -> 409 upload_already_committed; vượt DOCUMENT_MAX_BYTES -> 413 file_too_large).",
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
		summary: "List document comments",
		description: "Bình luận của tài liệu, cũ nhất trước, mỗi dòng kèm reactions; kind lọc comment hoặc discussion (bỏ trống = cả hai). " +
			"Mọi câu trả lời mang list_token; since_token trùng token hiện tại trả unchanged=true kèm danh sách rỗng. Cần quyền xem.",
		tags: []string{"documents"},
		sdi:  sdi.ListDocumentCommentsSDI{},
		sdo:  sdo.DocumentCommentListSDO{},
		auth: true,
	})
	d.Post("/documents/{documentID}/comments", h.CreateDocumentComment, apiOp{
		summary: "Add a document comment",
		description: "Thêm bình luận (hoặc trả lời qua parent_id cùng tài liệu) - cần quyền sửa. type chỉ nhận comment: client công khai không tạo được bình luận hệ thống. " +
			"Idempotency-Key ràng create với fingerprint payload: replay trả bình luận đó ở trạng thái hiện tại (đã bị xóa hẳn -> 404), payload khác cùng key -> 409 idempotency_payload_mismatch. Thành công trả 201.",
		tags:   []string{"documents"},
		sdi:    sdi.CreateDocumentCommentSDI{},
		sdo:    sdo.DocumentCommentSDO{},
		status: 201,
		auth:   true,
	})
	d.Put("/documents/{documentID}/comments/anchors", h.PutDocumentCommentAnchors, apiOp{
		summary: "Update document comment anchors",
		description: "Bản đồ neo editor gửi sau receipt Lưu (cần quyền sửa). version_id phải thuộc đúng tài liệu và tenant, không thì 400 anchor_version_invalid và không ghi gì. " +
			"So sánh bằng số version: neo không bao giờ lùi về phiên bản cũ hơn (bỏ qua trong skipped với older_version); exact chỉ khi version là head, còn lại tự hạ stale; editor báo lost thì giữ lost. " +
			"Comment không thuộc tài liệu, là discussion, trả lời hoặc đã xóa bị bỏ qua im lặng (not_applicable). Lặp cùng payload không đổi dòng nào, không phát sự kiện; có đổi thì một event document.comment_anchors_updated trong cùng giao dịch.",
		tags: []string{"documents"},
		sdi:  sdi.PutDocumentCommentAnchorsSDI{},
		sdo:  sdo.DocumentCommentAnchorsSDO{},
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
		summary: "Delete a document comment",
		description: "Xóa bình luận: tác giả hoặc người có quyền manage. Còn phản hồi thì giữ khung \"Nội dung đã bị xóa\" (outcome=tombstoned), " +
			"không còn phản hồi thì bỏ hẳn dòng (outcome=removed); reactions và lịch sử sửa của chính nó bị xóa thật trong cùng giao dịch.",
		tags: []string{"documents"},
		sdo:  sdo.DocumentCommentDeleteSDO{},
		auth: true,
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
	d.Get("/documents/{documentID}/comments/{commentID}/revisions", h.ListDocumentCommentRevisions, apiOp{
		summary:     "List a document comment's revisions",
		description: "Lịch sử sửa của bình luận, mới nhất trước; mỗi dòng là nội dung trước một lần sửa. Cần quyền xem. Bình luận đã xóa trả 409 comment_deleted.",
		tags:        []string{"documents"},
		sdo:         sdo.DocumentCommentRevisionListSDO{},
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
	d.Get("/documents/{documentID}/mention-candidates", h.ListDocumentMentionCandidates, apiOp{
		summary: "List mention candidates for a document",
		description: "Người có ít nhất quyền xem tài liệu hiện tại (thành viên workspace hiệu lực + người được chia sẻ), mới bị vô hiệu thì loại: " +
			"người gọi cần quyền xem trên tài liệu; người ngoài tổ chức -> 404. Tìm theo tên hiển thị và email (gấp dấu uw_fold_search), " +
			"mặc định 20 kết quả, tối đa 50 (ngoài khoảng bị kẹp). Email chỉ có khi người gọi xem được danh sách thành viên của workspace chứa tài liệu.",
		tags: []string{"documents"},
		sdi:  sdi.ListMentionCandidatesSDI{},
		sdo:  sdo.MentionCandidateListSDO{},
		auth: true,
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
		summary: "List documents",
		description: "Danh sách tài liệu workspace, mới sửa trước. parent_id = một cấp cây theo position; q = tìm toàn workspace kèm snippet; shared_by_me=true = tài liệu sống người gọi làm ACL owner đang chia sẻ (dùng cùng parent_id -> 400 invalid_filter); kind/archived/updated_by/updated_from/updated_to là filter. " +
			"format (docx, xlsx, pptx, pdf, md, html) lọc theo định dạng của phiên bản hiện tại (MIME đã xác minh, nếu không có thì theo phần mở rộng tiêu đề; thư mục luôn ở lại, trang không khớp) và access (manage, edit, restricted) lọc theo quyền của người gọi trên dòng, cùng cấp mà my_level báo. " +
			"Giá trị lạ, format cùng kind=page, và access=manage/edit trên thùng rác -> 400 invalid_filter. Quyền và cả hai filter được lọc trong query trước limit nên cursor ổn định và trang luôn đầy khi còn dòng khớp; archived=1 chỉ manage.",
		tags: []string{"documents"},
		sdi:  sdi.ListDocumentsSDI{},
		sdo:  sdo.DocumentListSDO{},
		auth: true,
	})
	d.Get("/workspaces/{workspaceID}/documents/recent", h.ListRecentDocuments, apiOp{
		summary:     "List recent documents",
		description: "Tài liệu người dùng đã mở (access log) hoặc sửa gần đây, lọc quyền trước limit, cursor ổn định. format và access nhận như danh sách phẳng (giá trị lạ -> 400 invalid_filter). Agent không có \"gần đây\" -> 403.",
		tags:        []string{"documents"},
		sdi:         sdi.ListRecentDocumentsSDI{},
		sdo:         sdo.DocumentListSDO{},
		auth:        true,
	})
	d.Get("/workspaces/{workspaceID}/documents/changes", h.ListDocumentChanges, apiOp{
		summary:     "List document changes (Office change feed)",
		description: "Feed đồng bộ Office (G5-01a). Không cursor = mở snapshot nhất quán tại high-water mark; thành viên và giá trị cố định qua mọi trang, chỉ id/kind/revision/version. Cursor opaque có ký, buộc tài khoản, deployment, tổ chức, workspace và protocol; giả hoặc sai phạm vi -> 400 change_cursor_invalid; hết hạn hoặc snapshot đã dọn -> 410 change_cursor_expired (không bao giờ trả trang thiếu). Trang cuối trả cursor feed cho G5-01b. office_sync_feed tắt -> 403 office_capability_off.",
		tags:        []string{"documents"},
		sdi:         sdi.ListDocumentChangesSDI{},
		sdo:         sdo.DocumentChangeListSDO{},
		auth:        true,
	})
	d.Get("/workspaces/{workspaceID}/documents/shared-with-me", h.ListSharedWithMe, apiOp{
		summary:     "List documents shared with me",
		description: "Tài liệu người gọi nhận qua share, gồm workspace khác trong tổ chức; một share đã thu hồi hoặc không còn hiệu lực sẽ biến mất. Duyệt ứng viên bằng keyset và lọc quyền trước khi xếp trang nên ứng viên bị từ chối không chiếm suất; cursor ổn định như các list khác. format và access (cấp người gọi nhận qua share) nhận như danh sách phẳng, giá trị lạ -> 400 invalid_filter. Workspace trên URL là ngữ cảnh thành viên, danh sách trải theo tổ chức.",
		tags:        []string{"documents"},
		sdi:         sdi.ListSharedWithMeSDI{},
		sdo:         sdo.DocumentListSDO{},
		auth:        true,
	})
	d.Get("/workspaces/{workspaceID}/documents/access-report", h.DocumentAccessReport, apiOp{
		summary:     "Read the document access report",
		description: "Báo cáo quyền truy cập (UNI-1643) trên cả workspace hoặc một thư mục (folder_id, gồm thư mục con). Mỗi dòng là một đường cấp quyền: chủ sở hữu ACL, thành viên workspace, chia sẻ sống; kèm effective_level, người cấp, ngày cấp, số liên kết công khai sống. Chỉ liệt kê tài liệu người gọi quản lý; tài liệu đọc được nhưng không quản lý đếm vào summary.skipped. Không phải thành viên workspace hoặc agent -> 403; folder_id không dùng được -> 404. Chỉ tên, không email. Cursor keyset theo id.",
		tags:        []string{"documents"},
		sdi:         sdi.DocumentAccessReportSDI{},
		sdo:         sdo.DocumentAccessReportSDO{},
		auth:        true,
	})
	d.Get("/workspaces/{workspaceID}/documents/access-report/export", h.ExportDocumentAccessReport, apiOp{
		summary:     "Export the document access report",
		description: "Cùng báo cáo quyền truy cập, toàn bộ trong một snapshot, thành tệp CSV (UTF-8 BOM) hoặc XLSX; tệp ghi bộ lọc đang áp dụng và thời điểm tạo. Quá 10.000 dòng -> 422 access_report_too_large trước khi ghi byte nào. Ghi một dòng audit documents.access_report_exported (chỉ id, bộ lọc, số đếm).",
		tags:        []string{"documents"},
		sdi:         sdi.DocumentAccessReportExportSDI{},
		produces:    "text/csv; charset=utf-8",
		auth:        true,
	})
	d.Get("/workspaces/{workspaceID}/documents/tree", h.DocumentTree, apiOp{
		summary:     "Read the document tree",
		description: "Cây sidebar tối đa 20 cấp, chỉ metadata {id,title,icon,kind,position,children}; root chọn một nhánh, folders_only=1 chỉ trả thư mục. Node dưới tổ tiên không đọc được sẽ rời cây cùng tổ tiên; root không đọc được (hoặc không phải thư mục khi folders_only) -> 404.",
		tags:        []string{"documents"},
		sdi:         sdi.DocumentTreeSDI{},
		sdo:         sdo.DocumentTreeSDO{},
		auth:        true,
	})
	d.Post("/documents/{documentID}/move", h.MoveDocument, apiOp{
		summary:     "Move a document",
		description: "Đổi cha/thứ tự trong cùng workspace. Kiểm edit cả nguồn lẫn đích; chu trình (kể cả thư mục vào chính nó hoặc thư mục con) -> 422 document_cycle, cha sai loại -> 422 document_parent_kind, quá 20 cấp -> 422 document_too_deep, khác workspace -> 422 cross_workspace_reference; tài liệu thuộc Work Product -> 409. Idempotency-Key replay an toàn.",
		tags:        []string{"documents"},
		sdi:         sdi.MoveDocumentSDI{},
		sdo:         sdo.DocumentSDO{},
		auth:        true,
	})
	d.Post("/documents/{documentID}/archive", h.ArchiveDocument, apiOp{
		summary:     "Archive a document subtree",
		description: "Đưa tài liệu (hoặc thư mục) và cả cây con vào thùng rác trong một transaction sau khi kiểm manage trên từng node sống; node restricted không manage được sẽ chặn cả lệnh; quá 1000 node sống -> 422 folder_too_large (hãy lưu trữ từng phần). Idempotency-Key replay trả kết quả đã lưu.",
		tags:        []string{"documents"},
		sdo:         sdo.DocumentArchiveSDO{},
		auth:        true,
	})
	d.Get("/documents/{documentID}/archive-impact", h.ArchiveImpact, apiOp{
		summary: "Read the archive impact of a subtree",
		description: "Số đếm cho hộp thoại xóa (FD-04): {folders, documents, total, max_nodes, too_large}, đọc trong một transaction RepeatableRead read-only nên id, quyền và số đến từ một snapshot. " +
			"Cùng thứ tự kiểm với lệnh lưu trữ: manage trên gốc (không đủ -> cùng 403/404), cây con sống giới hạn 1000 nút, manage trên từng nút của đúng tập id đó. " +
			"folders/documents không gồm gốc (trang con trong trang tính là documents); total gồm gốc = số dòng lệnh lưu trữ sẽ ghi. Vượt trần -> {too_large: true, max_nodes: 1000}, không có số đếm. Không ghi audit.",
		tags: []string{"documents"},
		sdo:  sdo.DocumentArchiveImpactSDO{},
		auth: true,
	})
	d.Post("/documents/{documentID}/restore", h.RestoreDocument, apiOp{
		summary:     "Restore an archived document",
		description: "Khôi phục mục trong thùng rác và các hậu duệ cùng batch còn trong thùng rác mà người gọi quản lý (RESTORE-01 §1); hậu duệ không quản lý ở lại thùng rác. Idempotency-Key replay trả kết quả đã lưu.",
		tags:        []string{"documents"},
		sdo:         sdo.DocumentArchiveSDO{},
		auth:        true,
	})
	d.Post("/documents/{documentID}/purge", h.PurgeDocument, apiOp{
		summary:     "Permanently delete an archived document",
		description: "Xóa vĩnh viễn một mục đang trong thùng rác và các hậu duệ cùng batch còn trong thùng rác mà người gọi quản lý (RESTORE-01 §2): dọn mọi bảng phụ thuộc, nhả blob qua FileService và ghi audit/outbox document.deleted (metadata manual_purge=true) trong một transaction. Mục đang sống -> 400 document_not_in_trash; dưới manage -> 403; không thấy -> 404; quá 1000 nút -> 400 folder_too_large.",
		tags:        []string{"documents"},
		status:      http.StatusNoContent,
		auth:        true,
	})
	d.Get("/documents/{documentID}/shares", h.ListDocumentShares, apiOp{
		summary:     "List document access",
		description: "Người gọi luôn thấy my_level/via của mình (rỗng khi admin_scope và chưa có quyền đọc); chỉ người quản trị (manage hoặc admin_scope) thấy acl_owner, danh sách grant sống (kèm effective_level), liên kết công khai sống và break_glass[] (truy cập khẩn cấp còn hiệu lực, mới nhất trước). Grant đã thu hồi không xuất hiện.",
		tags:        []string{"documents"},
		sdo:         sdo.DocumentAccessSDO{},
		auth:        true,
	})
	d.Post("/documents/{documentID}/shares", h.CreateDocumentShare, apiOp{
		summary: "Share a document",
		description: "Cấp view/comment/edit/manage cho user, workspace hoặc organization cùng tổ chức; principal ngoài tổ chức -> 422 principal_not_in_organization. Trùng principal sống thì grant cũ bị thu hồi và thay trong cùng transaction. Chỉ manage; tài liệu thuộc Work Product -> 409. " +
			"Share cho chính workspace chứa tài liệu không tạo dòng document_shares: nó ghi vào dòng Workspace gốc (visibility=workspace, workspace_level=level) và câu trả lời mô tả dòng đó (id và created_at rỗng); manage -> 422 level_not_allowed (dòng gốc tối đa edit), và mở một tài liệu riêng tư khi người gọi chỉ có admin_scope -> 403 break_glass_required.",
		tags:   []string{"documents"},
		sdi:    sdi.ShareDocumentSDI{},
		sdo:    sdo.DocumentShareSDO{},
		status: http.StatusCreated,
		auth:   true,
	})
	d.Post("/documents/{documentID}/shares/batch", h.CreateDocumentShareBatch, apiOp{
		summary: "Share a document with a batch of users",
		description: "Cấp view/edit/manage cho 1–50 người dùng cùng tổ chức trong một transaction (all-or-nothing); trùng lặp được gộp và giữ thứ tự xuất hiện đầu. " +
			"Danh sách rỗng, có phần tử rỗng hoặc level sai -> 400 invalid_request; không đọc được -> 404; dưới manage -> 403; tài liệu thuộc Work Product -> 409 document_owned_by_work_product; " +
			"vượt 50 người dùng phân biệt -> 422 share_batch_too_large (fields.max=50); có người ngoài tổ chức -> 422 principal_not_in_organization (fields.principal_ids).",
		tags:   []string{"documents"},
		sdi:    sdi.ShareDocumentBatchSDI{},
		sdo:    sdo.DocumentShareBatchSDO{},
		status: http.StatusCreated,
		auth:   true,
	})
	d.Delete("/documents/{documentID}/shares/{shareID}", h.RevokeDocumentShare, apiOp{
		summary:     "Revoke a document share",
		description: "Thu hồi một grant đang sống (ghi revoked_at, giữ lịch sử). Chỉ manage; share không thuộc tài liệu -> 404.",
		tags:        []string{"documents"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	d.Post("/documents/{documentID}/break-glass", h.CreateDocumentBreakGlass, apiOp{
		summary:     "Open emergency access to a restricted document",
		description: "Chủ/quản trị workspace (không phải ACL owner) mở quyền xem khẩn cấp 24 giờ trên tài liệu restricted: chỉ xem, cần lý do 10–500 ký tự sau khi cắt khoảng trắng (sai -> 422 break_glass_reason_invalid kèm fields min/max/length), ghi nhật ký và báo cho chủ tài liệu. 201 khi tạo grant mới; 200 cùng nội dung khi người gọi đã có grant còn hiệu lực (không ghi thêm nhật ký/thông báo). Người đọc không phải quản trị -> 403 forbidden; tài liệu thuộc Work Product -> 409.",
		tags:        []string{"documents"},
		sdi:         sdi.BreakGlassSDI{},
		sdo:         sdo.DocumentBreakGlassSDO{},
		status:      http.StatusCreated,
		auth:        true,
	})
	d.Delete("/documents/{documentID}/break-glass/{grantID}", h.RevokeDocumentBreakGlass, apiOp{
		summary:     "End emergency access",
		description: "Người giữ grant (Kết thúc truy cập) hoặc người quản trị tài liệu (ACL owner, manage, quản trị workspace) thu hồi grant ngay. Grant đã thu hồi hoặc hết hạn -> 200 (idempotent, không ghi thêm); grant không thuộc tài liệu -> 404.",
		tags:        []string{"documents"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	d.Get("/documents/{documentID}/admin-summary", h.GetDocumentAdminSummary, apiOp{
		summary:     "Read the admin summary of a document",
		description: "Metadata của tài liệu, ACL owner, quyền của người gọi và grant khẩn cấp còn hiệu lực của chính họ; không bao giờ có nội dung. Chỉ người quản trị tài liệu (ACL owner, manage, quản trị workspace); người đọc thấp hơn -> 403 forbidden.",
		tags:        []string{"documents"},
		sdo:         sdo.DocumentAdminSummarySDO{},
		auth:        true,
	})
	d.Post("/documents/{documentID}/links", h.CreateDocumentLink, apiOp{
		summary:     "Create a public link",
		description: "Liên kết xem ẩn danh: cần entitlement documents.public_links và công tắc tổ chức; tối đa 5 liên kết sống -> 422 document_link_limit; thư mục không có liên kết công khai -> 422 folder_not_supported. Token chỉ trả một lần cùng url trang chia sẻ; server chỉ giữ SHA-256.",
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
	d.Get("/orgs/{orgID}/documents/settings", h.GetDocumentSettings, apiOp{
		summary:     "Read the organization public-link switch",
		description: "Công tắc liên kết công khai của tổ chức. Chỉ owner/admin tổ chức đọc được; tổ chức chưa từng đổi trả về mặc định tắt (không ghi dòng nào).",
		tags:        []string{"documents"},
		sdo:         sdo.DocumentSettingsSDO{},
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
