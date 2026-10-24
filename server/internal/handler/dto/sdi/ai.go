package sdi

import "encoding/json"

// AskUniFocusSDI names the object the question is about (optional).
type AskUniFocusSDI struct {
	Kind string `json:"kind" description:"Focus: task, meeting, email_thread, document, project hoặc room. Mention: task, meeting, document, project, room hoặc member" example:"room"`
	ID   string `json:"id" example:"01J8X4K2M0N1P2Q3R4S5T6U7VA"`
}

// AskUniSDI is POST /api/v1/workspaces/{workspaceID}/ai/ask.
type AskUniSDI struct {
	ConversationID      string           `json:"conversation_id" description:"Tiếp tục hội thoại của chính người gọi; rỗng = hội thoại mới" example:"01K4AICONV000000000000001"`
	Question            string           `json:"question" maxLength:"2000" description:"Câu hỏi (bắt buộc trừ khi có regenerate_message_id); UNI chỉ trả lời từ dữ liệu người gọi được xem" example:"task nào quá hạn?"`
	Focus               *AskUniFocusSDI  `json:"focus,omitempty"`
	Mentions            []AskUniFocusSDI `json:"mentions,omitempty" maxItems:"5" description:"Tối đa 5 đối tượng người hỏi nhắc tới (task, meeting, document, project, room, member); mỗi đối tượng phải đọc được bằng quyền người hỏi, nếu không trả ai_context_forbidden" example:"[{\"kind\":\"document\",\"id\":\"01J8X4K2M0N1P2Q3R4S5T6U7VA\"}]"`
	Locale              string           `json:"locale" description:"vi hoặc en; mặc định en" example:"vi"`
	Model               string           `json:"model,omitempty" maxLength:"20" description:"Rỗng = Tự động; haiku, sonnet hoặc opus. Giá trị không dùng được (tắt, chưa có giá, lạ) thì server dùng Tự động, không báo lỗi. Chỉ có tác dụng khi agent bật" example:"sonnet"`
	Effort              string           `json:"effort,omitempty" maxLength:"20" description:"low, medium hoặc high; rỗng hoặc giá trị lạ = medium. Chỉ có tác dụng khi agent bật" example:"medium"`
	RegenerateMessageID string           `json:"regenerate_message_id,omitempty" description:"Chỉ route stream: id câu trả lời cuối của hội thoại để trả lời lại tại chỗ bằng câu hỏi và ngữ cảnh đã lưu (question bị bỏ qua); không phải câu trả lời cuối thì 400" example:"01K4AIMSG000000000000001"`
	Mode                string           `json:"mode,omitempty" maxLength:"10" description:"Chế độ của lượt hỏi trên route stream: ask (Hỏi trước), plan (Kế hoạch) hoặc auto (Tự động); rỗng = chế độ đã lưu của người hỏi. Server hạ xuống trần của tổ chức; giá trị lạ đọc là ask. Chỉ có tác dụng khi cờ ask_uni_actions bật" example:"ask"`
	AttachmentIDs       []string         `json:"attachment_ids,omitempty" maxItems:"5" description:"File do chính người hỏi tải lên qua POST …/ai/attachments và chưa gắn câu hỏi nào, theo thứ tự gắn; tối đa 5 file khác nhau, tổng tối đa 20 MB. Quá 5, trùng id hoặc đi kèm regenerate_message_id thì 400 ai_attachments_invalid; tổng quá 20 MB thì 422 ai_attachments_too_large; cờ tắt thì 403 ai_attachments_unavailable; id không phải file chưa gắn của chính người hỏi trong workspace này thì 404" example:"[\"01J8X4FILEN1P2Q3R4S5T6U7V8\"]"`
}

// ListAiConversationsSDI documents GET /api/v1/workspaces/{workspaceID}/ai/conversations query params.
type ListAiConversationsSDI struct {
	Q string `query:"q" description:"Tìm theo tiêu đề hội thoại (gấp dấu, 2–100 ký tự); bỏ trống = 20 hội thoại gần nhất" example:"việc trễ"`
}

// AiFeedbackSDI is PUT /api/v1/ai/conversations/{conversationID}/messages/{messageID}/feedback.
type AiFeedbackSDI struct {
	Rating string `json:"rating" description:"up hoặc down" example:"down"`
	Reason string `json:"reason,omitempty" description:"Rỗng, wrong_facts, missing_sources, not_helpful hoặc other" example:"wrong_facts"`
	Note   string `json:"note,omitempty" maxLength:"500" description:"Ghi chú tự do, tối đa 500 ký tự" example:"Sai ngày hạn của task"`
}

// AiRenameConversationSDI is PATCH /api/v1/ai/conversations/{conversationID}.
type AiRenameConversationSDI struct {
	Title string `json:"title" minLength:"1" maxLength:"80" description:"Tiêu đề mới, 1–80 ký tự sau khi cắt khoảng trắng hai đầu" example:"Việc quá hạn tuần này"`
}

// AskModelsSDI is PUT /api/v1/orgs/{org}/ai/ask-models.
type AskModelsSDI struct {
	Models []string `json:"models" description:"Bắt buộc. Các model Hỏi UNI được chọn rõ trong tổ chức (haiku, sonnet, opus); [] = chỉ Tự động. Thiếu trường, null hoặc khóa lạ -> 400. Tự động (model mặc định của nền tảng) luôn dùng được, công tắc này chỉ giới hạn các lựa chọn rõ" example:"[\"haiku\",\"sonnet\"]"`
}

// ChatCatchUpSDI is POST /api/v1/workspaces/{workspaceID}/ai/chat/catch-up (C-13.7).
type ChatCatchUpSDI struct {
	RoomID       string `json:"room_id" minLength:"1" description:"Phòng chat cần bắt kịp" example:"01J8XROOM0000000000000001"`
	ThreadRootID string `json:"thread_root_id,omitempty" description:"Nếu có: chỉ tóm tắt thread này" example:"01J8XMSG0000000000000001"`
	Locale       string `json:"locale" description:"vi hoặc en; mặc định en" example:"vi"`
	Since        string `json:"since,omitempty" description:"RFC3339: con trỏ đã đọc của phòng trước khi mở (mở phòng đã đánh dấu đọc); bỏ trống thì dùng con trỏ đang lưu. Không áp dụng cho thread" example:"2026-03-26T10:00:00.123456Z"`
}

// UploadAiAttachmentSDI is POST /api/v1/workspaces/{workspaceID}/ai/attachments (multipart).
type UploadAiAttachmentSDI struct {
	File []byte `formData:"file" description:"Tệp gắn vào câu hỏi: ảnh PNG, JPEG, GIF, WebP, PDF, DOCX, XLSX, PPTX, ODT, văn bản TXT, CSV hoặc Markdown, tối đa 20 MiB. Loại tệp xét theo nội dung"`
}

// AiProposalEditSDI is PATCH /api/v1/ai/proposals/{proposalID}.
type AiProposalEditSDI struct {
	Changes map[string]json.RawMessage `json:"changes" description:"Các trường đổi, {tên trường: giá trị}, ghép vào tham số của đề xuất rồi kiểm lại như một lần gọi mới; trường lạ hoặc giá trị sai thì 400. workspace_id và revision do server giữ" swaggertype:"object" example:"{\"title\":\"Viết spec F-09 v2\"}"`
}

// AiApplyProposalsSDI is POST /api/v1/ai/conversations/{conversationID}/messages/{messageID}/proposals/apply.
type AiApplyProposalsSDI struct {
	ProposalIDs []string `json:"proposal_ids" maxItems:"10" description:"Các dòng đề xuất của câu trả lời được duyệt, tối đa 10; chạy theo thứ tự position. Ở chế độ Kế hoạch, dòng pending không được chọn bị bỏ qua trong cùng lần gọi" example:"[\"01K4AIPRP000000000000001\"]"`
}

// AskUniModeSDI is PUT /api/v1/me/ask-uni-mode.
type AskUniModeSDI struct {
	Mode string `json:"mode" description:"ask (Hỏi trước), plan (Kế hoạch) hoặc auto (Tự động); giá trị khác thì 400" example:"plan"`
}

// AskWritePolicySDI is PUT /api/v1/orgs/{org}/ai/ask-write-policy.
type AskWritePolicySDI struct {
	Ceiling string `json:"ceiling" description:"Trần chế độ ghi của Hỏi UNI trong tổ chức: off, ask, plan hoặc auto; giá trị khác thì 400" example:"plan"`
}

// AiMemoryCreateSDI is POST /api/v1/orgs/{org}/ai/memory.
type AiMemoryCreateSDI struct {
	Kind string `json:"kind" description:"preference hoặc fact" example:"fact"`
	Text string `json:"text" description:"Một dòng 1–300 ký tự, không xuống dòng hay ký tự điều khiển" example:"Tôi làm ở phòng kinh doanh"`
}

// AiMemoryUpdateSDI is PATCH /api/v1/orgs/{org}/ai/memory/{memoryID}; a field left out stays.
type AiMemoryUpdateSDI struct {
	Kind *string `json:"kind" description:"preference hoặc fact; bỏ trống thì giữ" example:"preference"`
	Text *string `json:"text" description:"Chữ mới 1–300 ký tự; bỏ trống thì giữ" example:"Trả lời ngắn gọn"`
}

// AiMemoryProposalEditSDI is PATCH /api/v1/ai/memory-proposals/{memoryProposalID}; a field left out stays.
type AiMemoryProposalEditSDI struct {
	Kind *string `json:"kind" description:"preference hoặc fact; bỏ trống thì giữ" example:"fact"`
	Text *string `json:"text" description:"Chữ sẽ lưu, 1–300 ký tự, một dòng; bỏ trống thì giữ" example:"Gọi tôi là Vinh"`
}

// AiMemorySwitchSDI is PUT /api/v1/me/ask-uni-memory.
type AiMemorySwitchSDI struct {
	Enabled bool `json:"enabled" description:"true bật Dùng bộ nhớ, false tắt" example:"true"`
}
