package sdi

// AskUniFocusSDI names the object the question is about (optional).
type AskUniFocusSDI struct {
	Kind string `json:"kind" description:"task, meeting, email_thread, room, thread hoặc message" example:"room"`
	ID   string `json:"id" example:"01J8X4K2M0N1P2Q3R4S5T6U7VA"`
}

// AskUniSDI is POST /api/v1/workspaces/{workspaceID}/ai/ask.
type AskUniSDI struct {
	ConversationID string          `json:"conversation_id" description:"Tiếp tục hội thoại của chính người gọi; rỗng = hội thoại mới" example:"01K4AICONV000000000000001"`
	Question       string          `json:"question" minLength:"1" maxLength:"2000" description:"Câu hỏi; UNI chỉ trả lời từ dữ liệu người gọi được xem" example:"task nào quá hạn?"`
	Focus          *AskUniFocusSDI `json:"focus,omitempty"`
	Locale         string          `json:"locale" description:"vi hoặc en; mặc định vi" example:"vi"`
}

// ChatCatchUpSDI is POST /api/v1/workspaces/{workspaceID}/ai/chat/catch-up (C-13.7).
type ChatCatchUpSDI struct {
	RoomID       string `json:"room_id" minLength:"1" description:"Phòng chat cần bắt kịp" example:"01J8XROOM0000000000000001"`
	ThreadRootID string `json:"thread_root_id,omitempty" description:"Nếu có: chỉ tóm tắt thread này" example:"01J8XMSG0000000000000001"`
	Locale       string `json:"locale" description:"vi hoặc en; mặc định vi" example:"vi"`
}
