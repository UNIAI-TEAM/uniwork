package sdi

// AskUniFocusSDI names the object the question is about (optional).
type AskUniFocusSDI struct {
	Kind string `json:"kind" description:"task hoặc meeting" example:"task"`
	ID   string `json:"id" example:"01J8X4K2M0N1P2Q3R4S5T6U7VA"`
}

// AskUniSDI is POST /api/v1/workspaces/{workspaceID}/ai/ask.
type AskUniSDI struct {
	ConversationID string          `json:"conversation_id" description:"Tiếp tục hội thoại của chính người gọi; rỗng = hội thoại mới" example:"01K4AICONV000000000000001"`
	Question       string          `json:"question" minLength:"1" maxLength:"2000" description:"Câu hỏi; UNI chỉ trả lời từ dữ liệu người gọi được xem" example:"task nào quá hạn?"`
	Focus          *AskUniFocusSDI `json:"focus,omitempty"`
	Locale         string          `json:"locale" description:"vi hoặc en; mặc định vi" example:"vi"`
}
