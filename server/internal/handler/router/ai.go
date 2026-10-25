package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: ai — the AI gateway's HTTP surface (F-09): Ask UNI, its
// conversations, and usage. Requires Bearer. Every read runs as the caller;
// there is no way to ask on someone else's behalf.
//
//	GET    /api/v1/workspaces/{workspaceID}/ai/capabilities
//	POST   /api/v1/workspaces/{workspaceID}/ai/attachments
//	DELETE /api/v1/workspaces/{workspaceID}/ai/attachments/{fileID}
//	GET    /api/v1/workspaces/{workspaceID}/ai/attachments/{attachmentID}/content
//	POST   /api/v1/workspaces/{workspaceID}/ai/ask
//	POST   /api/v1/workspaces/{workspaceID}/ai/ask/stream
//	GET    /api/v1/workspaces/{workspaceID}/ai/conversations
//	GET    /api/v1/ai/conversations/{conversationID}/messages
//	DELETE /api/v1/ai/conversations/{conversationID}
//	PATCH  /api/v1/ai/conversations/{conversationID}
//	PUT    /api/v1/ai/conversations/{conversationID}/messages/{messageID}/feedback
//	DELETE /api/v1/ai/conversations/{conversationID}/messages/{messageID}/feedback
//	GET    /api/v1/workspaces/{workspaceID}/ai/usage
//	GET    /api/v1/orgs/{orgID}/ai/usage
//	GET    /api/v1/orgs/{org}/ai/ask-models
//	PUT    /api/v1/orgs/{org}/ai/ask-models
//	GET    /api/v1/orgs/{org}/ai/ask-write-policy
//	PUT    /api/v1/orgs/{org}/ai/ask-write-policy
//	GET    /api/v1/orgs/{org}/ai/memory
//	POST   /api/v1/orgs/{org}/ai/memory
//	PATCH  /api/v1/orgs/{org}/ai/memory/{memoryID}
//	DELETE /api/v1/orgs/{org}/ai/memory/{memoryID}
//	DELETE /api/v1/orgs/{org}/ai/memory
//	POST   /api/v1/orgs/{org}/ai/memory/import/split
//	POST   /api/v1/orgs/{org}/ai/memory/import
//	POST   /api/v1/ai/proposals/{proposalID}/apply
//	POST   /api/v1/ai/proposals/{proposalID}/reject
//	POST   /api/v1/ai/proposals/{proposalID}/undo
//	PATCH  /api/v1/ai/proposals/{proposalID}
//	POST   /api/v1/ai/conversations/{conversationID}/messages/{messageID}/proposals/apply
//	POST   /api/v1/ai/conversations/{conversationID}/messages/{messageID}/document
func registerAI(r api, h Routes) {
	r.Get("/workspaces/{workspaceID}/ai/capabilities", h.AiCapabilities, apiOp{
		summary:     "AI capabilities",
		description: "enabled=false khi server không có provider (client ẩn nút); quota token AI của tổ chức trong tháng.",
		tags:        []string{"ai"},
		sdo:         sdo.AiCapabilitiesSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/ai/attachments", h.UploadAiAttachment, apiOp{
		summary: "Upload a file for an Ask UNI question",
		description: "Tải một file lên để gắn vào câu hỏi Hỏi UNI kế tiếp (multipart, field file, tối đa 20 MiB; ảnh PNG/JPEG/GIF/WebP, PDF, DOCX, XLSX, PPTX, ODT, TXT, CSV, Markdown; loại xét theo nội dung). " +
			"File chưa thuộc câu hỏi nào cho tới khi câu hỏi gửi đi; không gửi thì tự dọn sau 24 giờ. Người tải lên là người duy nhất đọc, gắn hoặc hủy file. " +
			"403 ai_attachments_unavailable khi cờ ask_uni_attachments tắt hoặc lượt hỏi không chạy agent (cờ ask_uni_agent tắt, thiếu công cụ đọc hay model), 413 too_large hoặc file_too_large, 415 file_type_rejected, " +
			"422 ai_attachments_too_large khi ảnh quá 7,5 MB hay quá 8000 × 8000 điểm ảnh (giới hạn model nhận một ảnh), 422 ai_attachment_unreadable khi phần đầu ảnh không đọc được; file bị từ chối thì không giữ lại.",
		tags: []string{"ai"},
		sdi:  sdi.UploadAiAttachmentSDI{},
		sdo:  sdo.AiAttachmentUploadSDO{},
		auth: true,
	})
	r.Delete("/workspaces/{workspaceID}/ai/attachments/{fileID}", h.CancelAiAttachment, apiOp{
		summary:     "Cancel an Ask UNI file",
		description: "Bỏ file đã tải lên mà chưa có câu hỏi nào nhận. Chỉ người tải lên; file của người khác, của workspace khác, hoặc đã gắn vào câu hỏi → 404. Hủy lại vẫn 204.",
		tags:        []string{"ai"},
		status:      http.StatusNoContent,
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/ai/attachments/{attachmentID}/content", h.DownloadAiAttachment, apiOp{
		summary: "Download an Ask UNI file",
		description: "Tải về file một câu hỏi đã gắn, theo id của file trên câu hỏi (attachments[].id của GET …/messages), luôn là attachment và không bị đoán loại. " +
			"Chỉ người hỏi; file của người khác, của workspace khác, của tổ chức khác, của cuộc trò chuyện đã xóa hoặc id không có → cùng một 404. Không cần cờ ask_uni_attachments: file đã gắn vẫn tải được khi cờ tắt.",
		tags:     []string{"ai"},
		produces: "application/octet-stream",
		auth:     true,
	})
	r.Post("/workspaces/{workspaceID}/ai/ask", h.AskUni, apiOp{
		summary: "Ask UNI",
		description: "Một lượt hỏi, chỉ đọc, trả lời có trích dẫn [S1]… tới dữ liệu người gọi được xem. Câu hỏi có thể gắn tối đa 5 file đã tải lên qua POST …/ai/attachments (attachment_ids): câu hỏi và các file được lưu cùng lúc, file nào sai thì cả câu bị từ chối và không lưu gì. " +
			"Mỗi lượt UNI đọc file của câu hỏi và file của các câu hỏi còn trong lịch sử (tối đa 5, file gắn sau được ưu tiên), trong phần token dành cho file; file chỉ đọc một phần được ghi ở file_notes của câu trả lời. " +
			"400 ai_attachments_invalid, 402 ai_quota_exceeded, 403 ai_attachments_unavailable, 404 khi một id không phải file chưa gắn của chính người hỏi, 422 ai_attachments_too_large, 422 ai_attachment_unreadable khi một file đúng loại nhưng hỏng hoặc có mật khẩu (câu hỏi không được lưu), 422 media_unsupported khi provider đang chạy không đọc được loại file, 429 ai_rate_limited, 503 ai_disabled.",
		tags: []string{"ai"},
		sdi:  sdi.AskUniSDI{},
		sdo:  sdo.AskUniSDO{},
		auth: true,
	})
	r.Post("/workspaces/{workspaceID}/ai/ask/stream", h.AskUniStream, apiOp{
		summary: "Ask UNI (stream)",
		description: "Như Ask UNI nhưng trả text/event-stream. Frame: event run, step (kèm note: câu model viết trước khi gọi tool), reasoning (tóm tắt suy nghĩ của model, khi bật ask_uni_thinking), delta, citations, done hoặc error (data chỉ có mã). " +
			"Lỗi trước sự kiện đầu tiên trả JSON như POST …/ai/ask (400, 402, 403, 404, 422 gồm ai_attachment_unreadable, 429 kèm Retry-After, 503); sau đó là event error, ví dụ mã media_unsupported khi provider không đọc được file đã gắn. done mang câu trả lời đã lưu, kèm file_notes. Cứ 15 giây có dòng `: ping`.",
		tags:     []string{"ai"},
		sdi:      sdi.AskUniSDI{},
		produces: "text/event-stream",
		auth:     true,
	})
	r.Post("/workspaces/{workspaceID}/ai/chat/catch-up", h.ChatCatchUp, apiOp{
		summary:     "Chat CatchUp",
		description: "Tóm tắt tin chưa đọc trong phòng hoặc thread (C-13.7). Gợi ý action item; không tự tạo task. 402/429/503 như Ask UNI.",
		tags:        []string{"ai"},
		sdi:         sdi.ChatCatchUpSDI{},
		sdo:         sdo.ChatCatchUpSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/ai/conversations", h.ListAiConversations, apiOp{
		summary:     "My conversations",
		description: "20 hội thoại gần nhất của chính người gọi trong workspace; có q thì tìm theo tiêu đề (gấp dấu), tối đa 50.",
		tags:        []string{"ai"},
		sdi:         sdi.ListAiConversationsSDI{},
		sdo:         sdo.AiConversationListSDO{},
		auth:        true,
	})
	r.Get("/ai/conversations/{conversationID}/messages", h.ListAiMessages, apiOp{
		summary:     "Conversation messages",
		description: "Chủ hội thoại; người khác → 404.",
		tags:        []string{"ai"},
		sdo:         sdo.AiMessageListSDO{},
		auth:        true,
	})
	r.Delete("/ai/conversations/{conversationID}", h.DeleteAiConversation, apiOp{
		summary:     "Delete conversation",
		description: "Xóa hẳn hội thoại và tin nhắn; chủ hội thoại; người khác → 404.",
		tags:        []string{"ai"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.Patch("/ai/conversations/{conversationID}", h.RenameAiConversation, apiOp{
		summary:     "Rename conversation",
		description: "Chủ hội thoại đổi tiêu đề (1–80 ký tự sau khi cắt khoảng trắng); người khác → 404, tiêu đề sai → 400. Không ghi audit: lịch sử hội thoại AI là dữ liệu riêng của người dùng.",
		tags:        []string{"ai"},
		sdi:         sdi.AiRenameConversationSDI{},
		sdo:         sdo.AiConversationDTO{},
		auth:        true,
	})
	r.Put("/ai/conversations/{conversationID}/messages/{messageID}/feedback", h.SetAiFeedback, apiOp{
		summary:     "Rate an Ask UNI answer",
		description: "Mỗi người một đánh giá cho mỗi câu trả lời; gửi lại thì thay đánh giá cũ. Chỉ chủ hội thoại, chỉ tin của trợ lý; ngoài ra → 404. rating không phải up/down, reason lạ hoặc note quá 500 ký tự → 400. Không ghi audit.",
		tags:        []string{"ai"},
		sdi:         sdi.AiFeedbackSDI{},
		status:      http.StatusNoContent,
		auth:        true,
	})
	r.Delete("/ai/conversations/{conversationID}/messages/{messageID}/feedback", h.ClearAiFeedback, apiOp{
		summary:     "Withdraw my rating",
		description: "Gỡ đánh giá của người gọi; chưa có đánh giá vẫn trả 204. Chủ hội thoại, tin của trợ lý; ngoài ra → 404.",
		tags:        []string{"ai"},
		status:      http.StatusNoContent,
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/ai/usage", h.WorkspaceAiUsage, apiOp{
		summary:     "Workspace AI usage",
		description: "Tổng hợp theo ngày × capability × actor_kind. Query from, to (RFC3339 hoặc YYYY-MM-DD; mặc định 30 ngày). Owner/admin workspace.",
		tags:        []string{"ai"},
		sdo:         sdo.AiUsageSDO{},
		auth:        true,
	})
	r.Get("/orgs/{org}/ai/ask-models", h.GetOrgAskModels, apiOp{
		summary:     "Ask UNI models of an organization",
		description: "Các model Claude tổ chức đang bật cho Hỏi UNI (sắp theo chữ cái); chưa chỉnh thì là bộ mặc định (haiku, sonnet). Thành viên tổ chức.",
		tags:        []string{"ai"},
		sdo:         sdo.AskModelsSDO{},
		auth:        true,
	})
	r.Put("/orgs/{org}/ai/ask-models", h.SetOrgAskModels, apiOp{
		summary:     "Set the Ask UNI models of an organization",
		description: "Owner/admin tổ chức thay bộ model được chọn rõ; thiếu models, null hoặc khóa lạ -> 400 ([] = chỉ Tự động), thành viên thường -> 403. Tự động (model mặc định của nền tảng) luôn dùng được, không theo công tắc này. Không đổi gì thì không ghi audit; có đổi thì ghi organization.ask_models_changed.",
		tags:        []string{"ai"},
		sdi:         sdi.AskModelsSDI{},
		sdo:         sdo.AskModelsSDO{},
		auth:        true,
	})
	r.Get("/orgs/{orgID}/ai/usage", h.OrganizationAiUsage, apiOp{
		summary:     "Organization AI usage",
		description: "Như trên, mọi workspace của tổ chức, có workspace_id trên mỗi dòng. Owner/admin tổ chức.",
		tags:        []string{"ai"},
		sdo:         sdo.AiUsageSDO{},
		auth:        true,
	})
	r.Get("/orgs/{org}/ai/ask-write-policy", h.GetOrgAskWritePolicy, apiOp{
		summary: "Ask UNI write ceiling of an organization",
		description: "Trần chế độ ghi của Hỏi UNI trong tổ chức (off, ask, plan, auto); chưa đặt thì plan. Thành viên tổ chức. " +
			"Cờ ask_uni_actions tắt thì 403 ai_actions_disabled, như mọi route hành động của Hỏi UNI.",
		tags: []string{"ai"},
		sdo:  sdo.AskWritePolicySDO{},
		auth: true,
	})
	r.Put("/orgs/{org}/ai/ask-write-policy", h.SetOrgAskWritePolicy, apiOp{
		summary: "Set the Ask UNI write ceiling of an organization",
		description: "Owner/admin tổ chức đặt trần: off (UNI không đề xuất gì), ask, plan hoặc auto; giá trị khác -> 400, thành viên thường -> 403. " +
			"Chế độ của mỗi lượt và mỗi lần áp dụng bị hạ xuống trần này. Không đổi gì thì không ghi audit; có đổi thì ghi organization.ask_uni_write_policy_changed. " +
			"Cờ ask_uni_actions tắt thì 403 ai_actions_disabled.",
		tags: []string{"ai"},
		sdi:  sdi.AskWritePolicySDI{},
		sdo:  sdo.AskWritePolicySDO{},
		auth: true,
	})
	r.Get("/orgs/{org}/ai/memory", h.ListAiMemory, apiOp{
		summary: "My Ask UNI memory",
		description: "Các mục bộ nhớ của người gọi trong tổ chức (riêng từng người, không ai khác đọc được), cách trả lời trước, rồi theo thứ tự thêm (cũ trước), kèm công tắc, trần 50 và số chỗ còn lại. " +
			"Thành viên tổ chức; cờ ask_uni_memory tắt -> 403 ai_memory_disabled.",
		tags: []string{"ai"},
		sdo:  sdo.AiMemoryListSDO{},
		auth: true,
	})
	r.Post("/orgs/{org}/ai/memory", h.CreateAiMemory, apiOp{
		summary: "Add a memory entry",
		description: "Thêm một mục cho chính mình (source manual, ghi audit không kèm chữ). kind sai hoặc chữ rỗng, quá 300 ký tự, có xuống dòng -> 400; trùng một mục có sẵn -> 409 ai_memory_duplicate; đủ 50 mục -> 409 ai_memory_full; " +
			"cờ tắt -> 403 ai_memory_disabled.",
		tags:   []string{"ai"},
		sdi:    sdi.AiMemoryCreateSDI{},
		sdo:    sdo.AiMemoryDTO{},
		status: http.StatusCreated,
		auth:   true,
	})
	r.Patch("/orgs/{org}/ai/memory/{memoryID}", h.UpdateAiMemory, apiOp{
		summary: "Edit a memory entry",
		description: "Đổi kind và/hoặc chữ của mục của chính mình; trường bỏ trống thì giữ. Mục của người khác hay id không có -> 404 như nhau; chữ sai -> 400; trùng mục khác -> 409 ai_memory_duplicate; " +
			"cờ tắt -> 403 ai_memory_disabled.",
		tags: []string{"ai"},
		sdi:  sdi.AiMemoryUpdateSDI{},
		sdo:  sdo.AiMemoryDTO{},
		auth: true,
	})
	r.Delete("/orgs/{org}/ai/memory/{memoryID}", h.DeleteAiMemory, apiOp{
		summary:     "Delete a memory entry",
		description: "Xóa một mục của chính mình, không hoàn tác. Mục của người khác hay id không có -> 404 như nhau; cờ tắt -> 403 ai_memory_disabled.",
		tags:        []string{"ai"},
		status:      http.StatusNoContent,
		auth:        true,
	})
	r.Delete("/orgs/{org}/ai/memory", h.ClearAiMemory, apiOp{
		summary:     "Clear my memory",
		description: "Xóa toàn bộ mục của người gọi trong tổ chức này, không hoàn tác; trả số mục đã xóa (0 thì không ghi audit). Cờ tắt -> 403 ai_memory_disabled.",
		tags:        []string{"ai"},
		sdo:         sdo.AiMemoryClearSDO{},
		auth:        true,
	})
	r.Post("/orgs/{org}/ai/memory/import/split", h.SplitAiMemoryImport, apiOp{
		summary: "Split text pasted from another AI into memory entries",
		description: "Gọi model nhanh một lần (thử lại một lần khi sai định dạng, mỗi lần một dòng usage) để tách chữ dán thành tối đa 100 mục preference/fact; dòng đời tư, người khác, bí mật hay không nói về người dùng nằm trong skipped. " +
			"Không lưu gì, không ghi audit, không ghi chữ dán vào log. Chữ dán là dữ liệu không tin cậy: mục giống mệnh lệnh (link, \"ignore previous\"…) có instruction_like, mục trùng có duplicate. " +
			"Chữ rỗng hay quá 20.000 ký tự -> 400; quá 5 lần một giờ -> 429 ai_memory_import_rate_limited; model sai định dạng hai lần -> 502 ai_memory_import_failed; hết quota -> 402 ai_quota_exceeded; cờ ask_uni_memory tắt -> 403 ai_memory_disabled. Công tắc Dùng bộ nhớ không chặn.",
		tags: []string{"ai"},
		sdi:  sdi.AiMemoryImportSplitSDI{},
		sdo:  sdo.AiMemoryImportSplitSDO{},
		auth: true,
	})
	r.Post("/orgs/{org}/ai/memory/import", h.ImportAiMemory, apiOp{
		summary: "Save the entries the person ticked",
		description: "Lưu 1–50 mục đã tick trong một transaction (source import, mỗi mục một dòng audit ai_memory.created không kèm chữ); server kiểm lại như thêm tay. " +
			"Mục sai (kind, chữ rỗng, quá 300 ký tự, xuống dòng) -> 400 và không mục nào được lưu; mục trùng bộ nhớ hay trùng mục trước trong lần lưu thì bỏ qua và đếm trong skipped_duplicates; số mục còn lại vượt chỗ -> 409 ai_memory_full, không mục nào được lưu. " +
			"Cờ tắt -> 403 ai_memory_disabled. Công tắc Dùng bộ nhớ không chặn.",
		tags: []string{"ai"},
		sdi:  sdi.AiMemoryImportSDI{},
		sdo:  sdo.AiMemoryImportSDO{},
		auth: true,
	})
	r.Post("/ai/memory-proposals/{memoryProposalID}/apply", h.ApplyAiMemoryProposal, apiOp{
		summary: "Apply an Ask UNI memory proposal",
		description: "Người hỏi bấm Nhớ / Lưu / Quên trên thẻ đề xuất bộ nhớ: thêm, sửa hoặc xóa mục bộ nhớ của chính mình, ghi audit ai_memory.* (không kèm chữ) có metadata.via ask_uni; bấm hai lần chỉ chạy một lần. " +
			"Không bao giờ tự áp dụng, ở mọi chế độ; cờ ask_uni_actions và trần ghi không liên quan. Dòng của người khác hoặc không có -> 404 (không lộ dòng có tồn tại); cờ ask_uni_memory tắt -> 403 ai_memory_disabled; mất quyền workspace -> 403. " +
			"Mục update/forget nhắm tới đã bị xóa -> 404 ai_memory_not_found. 409 kèm dòng hiện tại trong error.fields.proposal: proposal_not_pending, proposal_expired (quá 24 giờ), ai_memory_off (người hỏi tắt Dùng bộ nhớ), ai_memory_full, ai_memory_duplicate.",
		tags: []string{"ai"},
		sdo:  sdo.AiMemoryProposalDTO{},
		auth: true,
	})
	r.Post("/ai/memory-proposals/{memoryProposalID}/reject", h.RejectAiMemoryProposal, apiOp{
		summary: "Reject an Ask UNI memory proposal",
		description: "Bỏ qua một đề xuất bộ nhớ pending của chính người hỏi, kể cả đã quá hạn: pending -> rejected, ghi audit ai_memory_proposal.rejected (không kèm chữ). " +
			"Dòng của người khác -> 404; cờ tắt -> 403 ai_memory_disabled; dòng không còn pending -> 409 proposal_not_pending kèm dòng trong error.fields.proposal.",
		tags: []string{"ai"},
		sdo:  sdo.AiMemoryProposalDTO{},
		auth: true,
	})
	r.Post("/ai/memory-proposals/{memoryProposalID}/undo", h.UndoAiMemoryProposal, apiOp{
		summary: "Undo an applied Ask UNI memory proposal",
		description: "Hoàn tác một lần một đề xuất bộ nhớ đã áp dụng: remember xóa mục đã tạo, update ghi lại chữ cũ, forget tạo lại mục (id mới); ghi audit ai_memory.* của lệnh ngược. " +
			"Mục đã bị sửa hoặc xóa sau khi áp dụng -> 409 undo_unavailable, dòng giữ applied; dòng không applied -> 409 proposal_not_pending; cả hai kèm dòng trong error.fields.proposal. Dòng của người khác -> 404; cờ tắt -> 403 ai_memory_disabled.",
		tags: []string{"ai"},
		sdo:  sdo.AiMemoryProposalDTO{},
		auth: true,
	})
	r.Patch("/ai/memory-proposals/{memoryProposalID}", h.EditAiMemoryProposal, apiOp{
		summary: "Edit an Ask UNI memory proposal",
		description: "Sửa loại và/hoặc chữ của một đề xuất remember/update pending trước khi áp dụng; trường bỏ trống thì giữ. Chữ sai hoặc sửa đề xuất forget -> 400; trùng một mục có sẵn -> 409 ai_memory_duplicate. " +
			"Không ghi audit: dòng là sổ sách AI cho tới khi áp dụng. Dòng của người khác -> 404; không còn pending / quá hạn -> 409 kèm dòng; cờ tắt -> 403 ai_memory_disabled.",
		tags: []string{"ai"},
		sdi:  sdi.AiMemoryProposalEditSDI{},
		sdo:  sdo.AiMemoryProposalDTO{},
		auth: true,
	})
	r.Post("/ai/proposals/{proposalID}/apply", h.ApplyAiProposal, apiOp{
		summary: "Apply an Ask UNI proposal",
		description: "Áp dụng một dòng đề xuất của chính người hỏi (nút Áp dụng): chạy lệnh nghiệp vụ như người hỏi, ghi audit ai_proposal.applied. Bấm hai lần chỉ chạy một lần. " +
			"Dòng của người khác hoặc không có -> 404 (không lộ dòng có tồn tại). Dòng không còn pending 409 proposal_not_pending, quá 24 giờ 409 proposal_expired, trỏ tới dòng chưa áp dụng 409 proposal_ref_pending, " +
			"cờ ask_uni_actions tắt hoặc trần off 403 ai_actions_disabled, quá 30 dòng mỗi phút 429 ai_write_rate_limited. " +
			"Lệnh chạy nhưng bị từ chối (not_found, invalid_args, revision_conflict, lỗi của lệnh…) thì dòng thành failed và route trả 409 với mã đó, kèm chính dòng trong error.fields.proposal; " +
			"khác với các từ chối trên, vốn không kèm dòng. Thành công trả 200 và dòng.",
		tags: []string{"ai"},
		sdo:  sdo.AiProposalDTO{},
		auth: true,
	})
	r.Post("/ai/proposals/{proposalID}/reject", h.RejectAiProposal, apiOp{
		summary:     "Reject an Ask UNI proposal",
		description: "Bỏ qua một dòng pending của chính người hỏi: pending → rejected, ghi audit ai_proposal.rejected. Dòng của người khác -> 404; không còn pending -> 409 proposal_not_pending; cờ tắt -> 403 ai_actions_disabled.",
		tags:        []string{"ai"},
		sdo:         sdo.AiProposalDTO{},
		auth:        true,
	})
	r.Post("/ai/proposals/{proposalID}/undo", h.UndoAiProposal, apiOp{
		summary: "Undo an applied Ask UNI proposal",
		description: "Hoàn tác một dòng đã áp dụng và còn lệnh ngược; mỗi dòng hoàn tác một lần. Đối tượng đã bị sửa sau đó thì 409 undo_unavailable và dòng giữ nguyên applied; " +
			"dòng không applied 409 proposal_not_pending. Ghi audit ai_proposal.undone. Dòng của người khác -> 404; cờ tắt -> 403 ai_actions_disabled.",
		tags: []string{"ai"},
		sdo:  sdo.AiProposalDTO{},
		auth: true,
	})
	r.Patch("/ai/proposals/{proposalID}", h.EditAiProposal, apiOp{
		summary: "Edit an Ask UNI proposal",
		description: "Sửa một dòng pending của chính người hỏi: changes ghép vào tham số rồi kiểm lại như một lần gọi mới (xem trước, mức và revision được dựng lại); trả dòng mới. " +
			"Sửa bị từ chối thì không đổi gì (400 invalid_request). Không ghi audit: dòng là sổ sách AI cho tới khi áp dụng. Dòng của người khác -> 404; không còn pending / quá hạn -> 409; cờ tắt -> 403 ai_actions_disabled.",
		tags: []string{"ai"},
		sdi:  sdi.AiProposalEditSDI{},
		sdo:  sdo.AiProposalDTO{},
		auth: true,
	})
	r.Post("/ai/conversations/{conversationID}/messages/{messageID}/proposals/apply", h.ApplyAiMessageProposals, apiOp{
		summary: "Apply several Ask UNI proposals of an answer",
		description: "Áp dụng các dòng được chọn của một câu trả lời (Áp dụng tất cả, hoặc duyệt kế hoạch), theo position; dừng ở dòng lỗi đầu tiên, các dòng chọn sau nó giữ pending. " +
			"Chế độ Kế hoạch: dòng pending không được chọn chuyển rejected trong cùng lần gọi. Một dòng chọn trỏ tới dòng chưa chọn và chưa áp dụng thì 409 proposal_ref_pending trước khi chạy gì. " +
			"proposal_ids rỗng hoặc quá 10 -> 400; id không thuộc câu trả lời của chính người hỏi -> 404. Thành công trả mọi dòng của câu trả lời. " +
			"Dừng vì lệnh bị từ chối thì 409 với mã của dòng lỗi, kèm mọi dòng của câu trả lời trong error.fields.proposals.",
		tags: []string{"ai"},
		sdi:  sdi.AiApplyProposalsSDI{},
		sdo:  sdo.AiProposalListSDO{},
		auth: true,
	})
	r.Post("/ai/conversations/{conversationID}/messages/{messageID}/document", h.SaveAiAnswerDocument, apiOp{
		summary: "Save an Ask UNI answer as a document",
		description: "Tạo tài liệu (trang riêng tư ở gốc) từ câu trả lời đã lưu của chính người hỏi: [S#] thành liên kết nội bộ, tiêu đề là tên hội thoại. Chạy như một dòng applied của tin đó (decision answer, position 0) và có Hoàn tác. " +
			"Một tin chỉ tạo một lần: lần hai trả dòng đã có. Tin không phải câu trả lời của trợ lý, hoặc của người khác -> 404; cờ tắt -> 403 ai_actions_disabled; lệnh bị từ chối -> 409 như apply, kèm dòng.",
		tags: []string{"ai"},
		sdo:  sdo.AiProposalDTO{},
		auth: true,
	})
}
