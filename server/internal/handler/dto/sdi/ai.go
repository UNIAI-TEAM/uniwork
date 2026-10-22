package sdi

// AskUniFocusSDI names the object the question is about (optional).
type AskUniFocusSDI struct {
	Kind string `json:"kind" description:"Focus: task, meeting, email_thread, document, project hoặc room. Mention: task, meeting, document, project hoặc member" example:"room"`
	ID   string `json:"id" example:"01J8X4K2M0N1P2Q3R4S5T6U7VA"`
}

// AskUniSDI is POST /api/v1/workspaces/{workspaceID}/ai/ask.
type AskUniSDI struct {
	ConversationID      string           `json:"conversation_id" description:"Tiếp tục hội thoại của chính người gọi; rỗng = hội thoại mới" example:"01K4AICONV000000000000001"`
	Question            string           `json:"question" maxLength:"2000" description:"Câu hỏi (bắt buộc trừ khi có regenerate_message_id); UNI chỉ trả lời từ dữ liệu người gọi được xem" example:"task nào quá hạn?"`
	Focus               *AskUniFocusSDI  `json:"focus,omitempty"`
	Mentions            []AskUniFocusSDI `json:"mentions,omitempty" maxItems:"5" description:"Tối đa 5 đối tượng người hỏi nhắc tới (task, meeting, document, project, member); mỗi đối tượng phải đọc được bằng quyền người hỏi, nếu không trả ai_context_forbidden" example:"[{\"kind\":\"document\",\"id\":\"01J8X4K2M0N1P2Q3R4S5T6U7VA\"}]"`
	Locale              string           `json:"locale" description:"vi hoặc en; mặc định en" example:"vi"`
	Model               string           `json:"model,omitempty" maxLength:"20" description:"Rỗng = Tự động; haiku, sonnet hoặc opus. Giá trị không dùng được (tắt, chưa có giá, lạ) thì server dùng Tự động, không báo lỗi. Chỉ có tác dụng khi agent bật" example:"sonnet"`
	Effort              string           `json:"effort,omitempty" maxLength:"20" description:"low, medium hoặc high; rỗng hoặc giá trị lạ = medium. Chỉ có tác dụng khi agent bật" example:"medium"`
	RegenerateMessageID string           `json:"regenerate_message_id,omitempty" description:"Chỉ route stream: id câu trả lời cuối của hội thoại để trả lời lại tại chỗ bằng câu hỏi và ngữ cảnh đã lưu (question bị bỏ qua); không phải câu trả lời cuối thì 400" example:"01K4AIMSG000000000000001"`
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
