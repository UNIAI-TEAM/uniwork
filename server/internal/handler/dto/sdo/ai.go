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
	// Models lists every model the server can run for Ask UNI, with the
	// organization's switch; auto_model is the key Auto resolves to.
	Models    []AiModelOptionDTO `json:"models" description:"Model Claude chạy được cho Hỏi UNI, theo thứ tự hiển thị"`
	AutoModel string             `json:"auto_model" description:"Khóa model mà Tự động dùng; rỗng nếu không trùng model nào" example:"sonnet"`
	// Attachments is false while ask_uni_attachments or ask_uni_agent is off
	// for the caller; the client then hides the upload entry.
	Attachments bool `json:"attachments" description:"true khi người gọi được gắn file vào câu hỏi (cờ ask_uni_attachments và ask_uni_agent đều bật); false thì client ẩn nút tải file" example:"true"`
}

// AiAttachmentUploadSDO is POST /api/v1/workspaces/{workspaceID}/ai/attachments:
// a file stored for the caller's next question, not yet attached to one.
type AiAttachmentUploadSDO struct {
	FileID string `json:"file_id" description:"ULID tệp; gửi trong attachment_ids của câu hỏi, hoặc DELETE …/ai/attachments/{fileID} để bỏ" example:"01J8X4FILEN1P2Q3R4S5T6U7V8"`
	Name   string `json:"name" description:"Tên tệp đã làm sạch" example:"bao-cao-quy-3.pdf"`
	MIME   string `json:"mime" description:"Loại tệp xét theo nội dung, không theo tên hay Content-Type của client" example:"application/pdf"`
	Size   int64  `json:"size" description:"Số byte" example:"184320"`
	Kind   string `json:"kind" description:"image, pdf hoặc text: cách Hỏi UNI đọc tệp này" example:"pdf"`
}

// AiModelOptionDTO is one selectable Ask UNI model.
type AiModelOptionDTO struct {
	Key          string `json:"key" description:"haiku, sonnet hoặc opus" example:"sonnet"`
	Provider     string `json:"provider" description:"Nhà cung cấp chạy model này: anthropic, openai, ollama" example:"anthropic"`
	Speed        int    `json:"speed" description:"Độ nhanh, 1-5" example:"4"`
	Intelligence int    `json:"intelligence" description:"Độ thông minh, 1-5" example:"4"`
	Cost         int    `json:"cost" description:"Nấc chi phí, 1-5, theo giá vào + ra" example:"3"`
	Enabled      bool   `json:"enabled" description:"Tổ chức đang bật model này" example:"true"`
}

// AskModelsSDO is GET and PUT /api/v1/orgs/{org}/ai/ask-models.
type AskModelsSDO struct {
	Models []string `json:"models" description:"Các model đang bật, sắp theo thứ tự chữ cái" example:"[\"haiku\",\"sonnet\"]"`
}

// AiCitationDTO is one validated source behind an answer.
type AiCitationDTO struct {
	SourceID string `json:"source_id" example:"S1"`
	Quote    string `json:"quote" example:"Hạn: 2026-09-05"`
	Kind     string `json:"kind" description:"task, meeting, document, project, chat, member (một người), members (danh sách thành viên), email_thread" example:"task"`
	Title    string `json:"title" example:"Viết spec F-09"`
	Href     string `json:"href" description:"Đường dẫn nội bộ" example:"/acme/team/tasks/01J8X4K2M0N1P2Q3R4S5T6U7VA"`
	ObjectID string `json:"object_id,omitempty" description:"Mã của đối tượng nguồn trỏ tới; vắng khi nguồn không là một đối tượng" example:"01J8X4K2M0N1P2Q3R4S5T6U7VA"`
}

// AiStepDTO is one tool the agent ran for an answer.
type AiStepDTO struct {
	Tool   string         `json:"tool" description:"Tên tool đã chạy" example:"search"`
	Label  string         `json:"label" description:"Từ khóa tìm hoặc tên đối tượng tool mở; rỗng nếu không có" example:"quá hạn"`
	Counts map[string]int `json:"counts" description:"Số nguồn mới tìm thấy theo loại" example:"{\"task\":3}"`
}

// AiContextRefDTO is an object a question named: its focus or an @-mention.
type AiContextRefDTO struct {
	Kind  string `json:"kind" description:"task, meeting, email_thread, document, project, room hoặc member" example:"task"`
	ID    string `json:"id" description:"Mã của đối tượng" example:"01J8X4K2M0N1P2Q3R4S5T6U7VA"`
	Title string `json:"title" description:"Tên đối tượng lúc hỏi" example:"Viết spec F-09"`
}

// AiMessageDTO is one turn of a conversation.
type AiMessageDTO struct {
	ID        string            `json:"id" example:"01K4AIMSG0000000000000001"`
	Role      string            `json:"role" description:"user hoặc assistant" example:"assistant"`
	Content   string            `json:"content" example:"Có 1 việc quá hạn: [S1] Viết spec F-09."`
	Citations []AiCitationDTO   `json:"citations"`
	Notice    string            `json:"notice,omitempty" description:"Mã thông báo thay cho nội dung: no_sources, empty_answer" example:"no_sources"`
	Steps     []AiStepDTO       `json:"steps" description:"Các bước tool agent đã chạy cho câu trả lời, theo thứ tự" example:"[{\"tool\":\"search\",\"label\":\"quá hạn\",\"counts\":{\"task\":3}}]"`
	Followups []string          `json:"followups" description:"Câu hỏi gợi ý tiếp theo" example:"[\"Việc nào trễ nhất?\"]"`
	Focus     *AiContextRefDTO  `json:"focus,omitempty" description:"Đối tượng câu hỏi đang xem; vắng khi không có" example:"{\"kind\":\"task\",\"id\":\"01J8X4K2M0N1P2Q3R4S5T6U7VA\",\"title\":\"Viết spec F-09\"}"`
	Mentions  []AiContextRefDTO `json:"mentions" description:"Các đối tượng người hỏi @-nhắc tới" example:"[{\"kind\":\"member\",\"id\":\"01J8X4K2M0N1P2Q3R4S5T6U7VA\",\"title\":\"An\"}]"`
	Model     string            `json:"model" description:"Model người hỏi chọn cho câu trả lời (haiku, sonnet, opus); rỗng khi là Tự động" example:"opus"`
	CreatedAt string            `json:"created_at" example:"2026-09-06T08:00:00Z"`
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

// The Ask UNI stream (ruling R3): each DTO is the data line of one SSE frame.

// AskStreamRunDTO is the data of event run.
type AskStreamRunDTO struct {
	RunID          string `json:"run_id" description:"Rỗng khi agent tắt" example:"01K4AIRUN000000000000001"`
	ConversationID string `json:"conversation_id" description:"Hội thoại của lượt hỏi" example:"01K4AICONV000000000000001"`
}

// AskStreamStepDTO is the data of event step; the client clears its draft.
type AskStreamStepDTO struct {
	Round  int            `json:"round" description:"Số thứ tự vòng gọi tool, từ 1" example:"1"`
	Phase  string         `json:"phase" description:"tool hoặc retry" example:"tool"`
	Tool   string         `json:"tool" description:"Tên tool vừa chạy; rỗng ở bước retry" example:"search"`
	Label  string         `json:"label" description:"Từ khóa tìm hoặc tên đối tượng tool mở; rỗng nếu không có" example:"quá hạn"`
	Counts map[string]int `json:"counts" description:"Số kết quả theo loại" example:"{\"task\":3}"`
}

// AskStreamDeltaDTO is the data of event delta.
type AskStreamDeltaDTO struct {
	Text string `json:"text" description:"Đoạn chữ nối thêm vào câu trả lời đang hiện" example:"Có 1 việc quá hạn"`
}

// AskStreamCitationsDTO is the data of event citations.
type AskStreamCitationsDTO struct {
	Citations []AiCitationDTO `json:"citations" description:"Nguồn trích dẫn đã kiểm của câu trả lời, theo thứ tự S1, S2…"`
}

// AskStreamSourcesDTO is the data of event sources: sources a step found
// that had no S# before.
type AskStreamSourcesDTO struct {
	Sources []AiCitationDTO `json:"sources" description:"Nguồn mới của bước vừa chạy, mỗi nguồn một số S# mới"`
}

// AskStreamFollowupsDTO is the data of event followups, sent before done
// when the answer suggests questions to ask next.
type AskStreamFollowupsDTO struct {
	Followups []string `json:"followups" description:"Câu hỏi gợi ý tiếp theo, tối đa 3, chỉ để đọc dữ liệu" example:"[\"Việc nào trễ nhất?\"]"`
}

// AskStreamTitleDTO is the data of event title, sent after done when UNI named
// a new conversation; the stream may stay open briefly for it.
type AskStreamTitleDTO struct {
	ConversationID string `json:"conversation_id" description:"Hội thoại vừa được UNI đặt tên" example:"01J8Z3Q4X5Y6A7B8C9D0E1F2G3"`
	Title          string `json:"title" description:"Tên ngắn UNI đặt cho hội thoại, tối đa 40 ký tự. Khung này đến sau done; luồng có thể mở thêm một lúc để chờ nó" example:"Việc trễ dự án Q4"`
}

// AskStreamUsageDTO is the tokens of a streamed turn.
type AskStreamUsageDTO struct {
	InputTokens      int `json:"input_tokens" description:"Token đầu vào của cả lượt, cộng mọi lần gọi model" example:"812"`
	OutputTokens     int `json:"output_tokens" description:"Token đầu ra của cả lượt" example:"96"`
	CacheReadTokens  int `json:"cache_read_tokens" description:"Token đọc từ cache prompt" example:"0"`
	CacheWriteTokens int `json:"cache_write_tokens" description:"Token ghi vào cache prompt" example:"0"`
}

// AskStreamDoneDTO is the data of event done: the stored answer.
type AskStreamDoneDTO struct {
	Message AiMessageDTO      `json:"message" description:"Câu trả lời đã lưu; thay cho mọi delta đã nhận"`
	Usage   AskStreamUsageDTO `json:"usage" description:"Token của lượt hỏi"`
}

// AskStreamErrorDTO is the data of event error: a code, never text.
type AskStreamErrorDTO struct {
	Code string `json:"code" description:"Mã lỗi, cùng mã với JSON của POST …/ai/ask; không có chữ mô tả" example:"ai_provider_error"`
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

// ChatCatchUpHighlightDTO is one key point of a CatchUp brief and the message it came from.
type ChatCatchUpHighlightDTO struct {
	Text            string `json:"text" description:"Ý chính" example:"An chốt demo thứ Sáu"`
	SourceMessageID string `json:"source_message_id,omitempty" description:"Tin gốc của ý chính; trống khi mô hình không chỉ ra" example:"01J8XMSG0000000000000001"`
}

// ChatCatchUpSDO is POST /api/v1/workspaces/{workspaceID}/ai/chat/catch-up.
type ChatCatchUpSDO struct {
	Summary        string                     `json:"summary" example:"An nhắc hạn spec F-09; Bình hỏi trạng thái PR."`
	Highlights     []string                   `json:"highlights" description:"Ý chính dạng chuỗi (client cũ); cùng thứ tự với highlight_items"`
	HighlightItems []ChatCatchUpHighlightDTO  `json:"highlight_items" description:"Ý chính kèm tin gốc"`
	ActionItems    []ChatCatchUpActionItemDTO `json:"action_items"`
	MessageCount   int                        `json:"message_count" example:"12"`
	Mode           string                     `json:"mode" description:"unread sau last_read; recent khi cửa sổ 48h (chưa join)" example:"unread"`
	Since          string                     `json:"since" example:"2026-09-11T08:00:00Z"`
	Usage          AiUsageDTO                 `json:"usage"`
}
