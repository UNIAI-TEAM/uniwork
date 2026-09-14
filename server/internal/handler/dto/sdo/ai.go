package sdo

// AiQuotaDTO is the organization's monthly AI token meter.
type AiQuotaDTO struct {
	UsedTokens  int64  `json:"used_tokens" example:"12500"`
	LimitTokens *int64 `json:"limit_tokens" description:"null = không giới hạn" example:"500000"`
}

// AiCapabilitiesSDO is GET /api/v1/workspaces/{workspaceID}/ai/capabilities.
type AiCapabilitiesSDO struct {
	Enabled        bool       `json:"enabled" description:"false khi server không có provider; client ẩn mọi nút AI" example:"true"`
	AskUni         bool       `json:"ask_uni" example:"true"`
	MeetingSummary bool       `json:"meeting_summary" description:"Gói có meeting.ai_summary" example:"true"`
	Quota          AiQuotaDTO `json:"quota"`
}

// AiCitationDTO is one validated source behind an answer.
type AiCitationDTO struct {
	SourceID string `json:"source_id" example:"S1"`
	Quote    string `json:"quote" example:"Hạn: 2026-09-05"`
	Kind     string `json:"kind" description:"task, meeting, chat, members" example:"task"`
	Title    string `json:"title" example:"Viết spec F-09"`
	Href     string `json:"href" description:"Đường dẫn nội bộ" example:"/acme/team/tasks/01J8X4K2M0N1P2Q3R4S5T6U7VA"`
}

// AiMessageDTO is one turn of a conversation.
type AiMessageDTO struct {
	ID        string          `json:"id" example:"01K4AIMSG0000000000000001"`
	Role      string          `json:"role" description:"user hoặc assistant" example:"assistant"`
	Content   string          `json:"content" example:"Có 1 việc quá hạn: [S1] Viết spec F-09."`
	Citations []AiCitationDTO `json:"citations"`
	CreatedAt string          `json:"created_at" example:"2026-09-06T08:00:00Z"`
}

// AiUsageDTO is what the call cost.
type AiUsageDTO struct {
	InputTokens  int `json:"input_tokens" example:"812"`
	OutputTokens int `json:"output_tokens" example:"96"`
}

// AskUniSDO is POST /api/v1/workspaces/{workspaceID}/ai/ask.
type AskUniSDO struct {
	ConversationID string       `json:"conversation_id" example:"01K4AICONV000000000000001"`
	Message        AiMessageDTO `json:"message"`
	Usage          AiUsageDTO   `json:"usage"`
}

// AiConversationDTO is one row of my conversations.
type AiConversationDTO struct {
	ID        string `json:"id" example:"01K4AICONV000000000000001"`
	Title     string `json:"title" example:"task nào quá hạn?"`
	CreatedAt string `json:"created_at" example:"2026-09-06T08:00:00Z"`
	UpdatedAt string `json:"updated_at" example:"2026-09-06T08:05:00Z"`
}

// AiConversationListSDO is GET /api/v1/workspaces/{workspaceID}/ai/conversations.
type AiConversationListSDO struct {
	Conversations []AiConversationDTO `json:"conversations"`
}

// AiMessageListSDO is GET /api/v1/ai/conversations/{conversationID}/messages.
type AiMessageListSDO struct {
	Messages []AiMessageDTO `json:"messages"`
}

// AiUsageRowDTO is one (day, capability, actor_kind[, workspace]) bucket.
type AiUsageRowDTO struct {
	Day          string `json:"day" example:"2026-09-06"`
	Capability   string `json:"capability" example:"copilot_answer"`
	ActorKind    string `json:"actor_kind" description:"human hoặc agent" example:"human"`
	WorkspaceID  string `json:"workspace_id,omitempty" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Calls        int64  `json:"calls" example:"14"`
	InputTokens  int64  `json:"input_tokens" example:"11000"`
	OutputTokens int64  `json:"output_tokens" example:"1400"`
	CostMicros   int64  `json:"cost_micros" description:"USD micro" example:"45000"`
}

// AiUsageSDO is GET .../ai/usage.
type AiUsageSDO struct {
	From string          `json:"from" example:"2026-08-07T00:00:00Z"`
	To   string          `json:"to" example:"2026-09-06T00:00:00Z"`
	Rows []AiUsageRowDTO `json:"rows"`
}

// ChatCatchUpActionItemDTO is one suggested follow-up from CatchUp (C-13.7).
type ChatCatchUpActionItemDTO struct {
	Title           string `json:"title" example:"Gửi bản nháp cho An"`
	Owner           string `json:"owner,omitempty" example:"An"`
	Due             string `json:"due,omitempty" example:"thứ Sáu"`
	SourceMessageID string `json:"source_message_id,omitempty" example:"01J8XMSG0000000000000001"`
}

// ChatCatchUpSDO is POST /api/v1/workspaces/{workspaceID}/ai/chat/catch-up.
type ChatCatchUpSDO struct {
	Summary      string                     `json:"summary" example:"An nhắc hạn spec F-09; Bình hỏi trạng thái PR."`
	Highlights   []string                   `json:"highlights"`
	ActionItems  []ChatCatchUpActionItemDTO `json:"action_items"`
	MessageCount int                        `json:"message_count" example:"12"`
	Mode         string                     `json:"mode" description:"unread sau last_read; recent khi cửa sổ 48h (chưa join)" example:"unread"`
	Since        string                     `json:"since" example:"2026-09-11T08:00:00Z"`
	Usage        AiUsageDTO                 `json:"usage"`
}
