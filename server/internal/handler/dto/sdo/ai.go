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
	// Attachments is false while ask_uni_attachments is off for the caller or
	// their turn would not run the agent; the client then hides the upload entry.
	Actions     AiActionsDTO    `json:"actions" description:"Trạng thái hành động ghi của Hỏi UNI cho người gọi"`
	Memory      AiMemoryCapsDTO `json:"memory" description:"Bộ nhớ của Hỏi UNI cho người gọi"`
	Attachments bool            `json:"attachments" description:"true khi người gọi được gắn file vào câu hỏi: cờ ask_uni_attachments bật và lượt hỏi chạy agent (cờ ask_uni_agent bật, công cụ đọc và model đã cấu hình); false thì client ẩn nút tải file" example:"true"`
}

// AiActionsDTO is Ask UNI's write state for the caller.
type AiActionsDTO struct {
	Enabled bool   `json:"enabled" description:"Cờ ask_uni_actions bật; false thì client không vẽ chế độ hay thẻ đề xuất" example:"true"`
	Ceiling string `json:"ceiling" description:"Trần của tổ chức: off, ask, plan hoặc auto" example:"plan"`
	Mode    string `json:"mode" description:"Chế độ người gọi chạy lượt hỏi sau khi hạ xuống trần: ask, plan hoặc auto; rỗng khi trần là off" example:"ask"`
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

// AiStepDTO is one tool the agent ran for an answer, or (kind think) the
// thinking that led to the answer.
type AiStepDTO struct {
	Tool    string         `json:"tool" description:"Tên tool đã chạy; rỗng ở bước retry và bước think" example:"search"`
	Label   string         `json:"label" description:"Từ khóa tìm hoặc tên đối tượng tool mở; rỗng nếu không có" example:"quá hạn"`
	Counts  map[string]int `json:"counts" description:"Số nguồn mới tìm thấy theo loại" example:"{\"task\":3}"`
	Note    string         `json:"note" description:"Câu model viết trước khi gọi tool của vòng này, chỉ ở bước đầu của vòng; rỗng nếu không có" example:"Mình xem các việc đang mở để tìm hạn gần nhất."`
	Thought string         `json:"thought" description:"Tóm tắt suy nghĩ của model trước bước này (ask_uni_thinking); rỗng nếu không có" example:"Cần lọc các việc quá hạn trước."`
	Kind    string         `json:"kind" description:"Rỗng cho bước tool hoặc retry; think là phần suy nghĩ trước câu trả lời" example:""`
}

// AiContextRefDTO is an object a question named: its focus or an @-mention.
type AiContextRefDTO struct {
	Kind  string `json:"kind" description:"task, meeting, email_thread, document, project, room hoặc member" example:"task"`
	ID    string `json:"id" description:"Mã của đối tượng" example:"01J8X4K2M0N1P2Q3R4S5T6U7VA"`
	Title string `json:"title" description:"Tên đối tượng lúc hỏi" example:"Viết spec F-09"`
}

// AiAttachmentDTO is one file a question carried.
type AiAttachmentDTO struct {
	ID   string `json:"id" description:"Id của file trên câu hỏi (không phải file_id lúc tải lên); dùng để tải file về" example:"01K4AIATT0000000000000001"`
	Name string `json:"name" description:"Tên tệp đã làm sạch" example:"bao-cao-quy-3.pdf"`
	MIME string `json:"mime" description:"Loại tệp xét theo nội dung" example:"application/pdf"`
	Size int64  `json:"size" description:"Số byte" example:"184320"`
	Kind string `json:"kind" description:"image, pdf hoặc text: cách Hỏi UNI đọc tệp này" example:"pdf"`
}

// AiFileNoteDTO is a file of the turn that UNI read only in part.
type AiFileNoteDTO struct {
	Name  string `json:"name" description:"Tên tệp" example:"bao-cao-quy-3.pdf"`
	Unit  string `json:"unit" description:"Đơn vị đếm: page, slide, row, paragraph hoặc line" example:"page"`
	Read  int    `json:"read" description:"Số đơn vị đầu đã đọc; 0 khi chỉ đọc được phần đầu của đơn vị thứ nhất" example:"15"`
	Total int    `json:"total" description:"Tổng số đơn vị của tệp" example:"80"`
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
	// Attachments is filled by the list of messages only; the stored answer an
	// ask or a done event returns is not the question, so it carries none.
	Attachments []AiAttachmentDTO `json:"attachments" description:"File câu hỏi đã gắn, theo thứ tự gắn; chỉ có trên tin nhắn của người hỏi trong danh sách tin nhắn, rỗng ở mọi tin nhắn khác (kể cả câu trả lời trong done)" example:"[{\"id\":\"01K4AIATT0000000000000001\",\"name\":\"bao-cao-quy-3.pdf\",\"mime\":\"application/pdf\",\"size\":184320,\"kind\":\"pdf\"}]"`
	// FileNotes is stored on the answer; a question carries none.
	FileNotes []AiFileNoteDTO `json:"file_notes" description:"Trên câu trả lời: các file của lượt hỏi UNI chỉ đọc một phần (vì vượt phần token dành cho file), theo thứ tự đọc; rỗng khi đọc đủ, khi không có file và ở tin nhắn của người hỏi" example:"[{\"name\":\"bao-cao-quy-3.pdf\",\"unit\":\"page\",\"read\":15,\"total\":80}]"`
	// Proposals is filled by the list of messages and the proposal event; the
	// done event's message carries none.
	Proposals []AiProposalDTO `json:"proposals" description:"Các dòng UNI đề xuất thay đổi trong câu trả lời, theo position; rỗng ở mọi tin khác" example:"[]"`
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
	Note   string         `json:"note" description:"Câu model viết trước khi gọi tool của vòng này, chỉ ở bước đầu của vòng; rỗng nếu không có" example:"Mình xem các việc đang mở để tìm hạn gần nhất."`
}

// AskStreamDeltaDTO is the data of event delta.
type AskStreamDeltaDTO struct {
	Text string `json:"text" description:"Đoạn chữ nối thêm vào câu trả lời đang hiện" example:"Có 1 việc quá hạn"`
}

// AskStreamReasoningDTO is the data of event reasoning.
type AskStreamReasoningDTO struct {
	Text string `json:"text" description:"Đoạn tóm tắt suy nghĩ nối thêm vào phần suy nghĩ của lần gọi model hiện tại (ask_uni_thinking)" example:"Cần xem các việc đang mở."`
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

// AskStreamProposalDTO is the data of event proposal: the turn's rows after the
// store and any auto-applied ones, before citations.
type AskStreamProposalDTO struct {
	Proposals []AiProposalDTO `json:"proposals" description:"Mỗi dòng mang trạng thái của nó; dòng tự áp dụng đến với status applied"`
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
	Tainted   bool   `json:"tainted" description:"true khi hội thoại đã đọc thứ không phải lời của chính người hỏi (hoặc có từ trước khi theo dõi): từ đó UNI không tự áp dụng gì" example:"false"`
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

// AiProposalChangeDTO is one field a proposal changed, as an applied row reports it.
type AiProposalChangeDTO struct {
	Field string `json:"field" description:"Tên trường đã đổi" example:"status"`
	From  any    `json:"from" description:"Giá trị trước, dạng đọc được" example:"\"todo\""`
	To    any    `json:"to" description:"Giá trị sau, dạng đọc được" example:"\"done\""`
}

// AiProposalResultDTO is what an applied row did; zero values on a row not applied.
type AiProposalResultDTO struct {
	ObjectID string                `json:"object_id" description:"Đối tượng đã tạo hoặc sửa" example:"01J8X4K2M0N1P2Q3R4S5T6U7VA"`
	Href     string                `json:"href" description:"Đường dẫn nội bộ tới đối tượng" example:"/acme/team/tasks/01J8X4K2M0N1P2Q3R4S5T6U7VA"`
	Revision int64                 `json:"revision" example:"3"`
	Changes  []AiProposalChangeDTO `json:"changes"`
	Note     string                `json:"note" description:"Mã ghi chú của server, không phải chữ giao diện" example:""`
}

// AiProposalFieldDTO is one field a proposal would change; from and to are readable values.
type AiProposalFieldDTO struct {
	Field   string   `json:"field" description:"Client dịch nhãn theo ai.proposal.field.<field>" example:"status"`
	Type    string   `json:"type" description:"text, markdown, date, datetime, enum, person, project hoặc labels" example:"enum"`
	From    any      `json:"from" description:"Giá trị trước, dạng đọc được (tên người, dự án, nhãn, trạng thái), không phải mã" example:"\"Cần làm\""`
	To      any      `json:"to" description:"Giá trị sau, dạng đọc được" example:"\"Hoàn thành\""`
	Options []string `json:"options,omitempty" description:"Các giá trị chọn được khi type là enum"`
}

// AiProposalAudienceDTO says who sees a change and who is told.
type AiProposalAudienceDTO struct {
	Visibility   string            `json:"visibility" description:"workspace, private, task, document, meeting hoặc room" example:"task"`
	RoomMembers  int               `json:"room_members,omitempty" description:"Số thành viên phòng khi visibility là room" example:"12"`
	Notifies     []AiContextRefDTO `json:"notifies" description:"Những người được báo"`
	NotifiesMore bool              `json:"notifies_more" description:"true khi còn người khác được báo (ví dụ người đã bình luận trước)" example:"false"`
}

// AiProposalPreviewDTO is what the card shows before anything is written.
type AiProposalPreviewDTO struct {
	Target        AiContextRefDTO       `json:"target" description:"Đối tượng bị đổi; id rỗng khi tạo mới"`
	Fields        []AiProposalFieldDTO  `json:"fields"`
	Body          string                `json:"body" description:"Chữ nguyên văn sẽ đăng (bình luận, tin chat) hoặc nội dung trang sẽ tạo; hiện bằng chữ thuần"`
	BodyTruncated bool                  `json:"body_truncated" description:"true khi body chỉ là phần đầu của nội dung (trang dài hơn thẻ hiện được); khi đó không sửa body từ thẻ" example:"false"`
	Audience      AiProposalAudienceDTO `json:"audience"`
	Refs          []int                 `json:"refs" description:"position của các dòng mà dòng này trỏ tới qua {{row:N.id}}"`
}

// AiProposalDTO is one row of a proposal card. A failed apply is answered
// 409 with the row's code and this row in error.fields.proposal, so a client
// repaints the card from the same shape whether the call succeeded or not.
type AiProposalDTO struct {
	ID        string               `json:"id" example:"01K4AIPRP000000000000001"`
	MessageID string               `json:"message_id" example:"01K4AIMSG0000000000000001"`
	Position  int                  `json:"position" description:"Thứ tự trong câu trả lời, từ 1; 0 là dòng Tạo tài liệu" example:"1"`
	Tool      string               `json:"tool" description:"Tên tool ghi" example:"update_task"`
	Level     string               `json:"level" description:"l1 (có thể tự áp dụng ở chế độ Tự động) hoặc l2 (luôn chờ người hỏi)" example:"l2"`
	Mode      string               `json:"mode" description:"Chế độ của lượt đã đề xuất: ask, plan hoặc auto" example:"ask"`
	Status    string               `json:"status" description:"pending, applying, applied, rejected, failed, undoing, undone; thêm expired (pending quá hạn 24 giờ) và unknown (applying/undoing quá 2 phút) tính lúc đọc" example:"pending"`
	Decision  string               `json:"decision" description:"Cách dòng được quyết: confirmed, plan, auto hoặc answer; rỗng khi chưa quyết" example:""`
	Preview   AiProposalPreviewDTO `json:"preview" description:"Những gì thẻ cho xem trước khi ghi gì"`
	Result    AiProposalResultDTO  `json:"result" description:"Những gì dòng đã làm; giá trị rỗng khi chưa áp dụng"`
	CanUndo   bool                 `json:"can_undo" description:"true khi dòng đã áp dụng và còn Hoàn tác" example:"false"`
	ErrorCode string               `json:"error_code" description:"Mã lỗi của dòng failed: not_found, invalid_args, revision_conflict, apply_failed…; rỗng khi không lỗi" example:""`
	Tainted   bool                 `json:"tainted" description:"Lượt đã đọc thứ không phải lời của người hỏi" example:"false"`
	ExpiresAt string               `json:"expires_at" example:"2026-09-07T08:00:00Z"`
}

// AiProposalListSDO is the answer of a call on several rows: every row of the
// answer in position order, as they stand after the call. When a row stops
// the run, the answer is 409 with the row's code and these rows in
// error.fields.proposals.
type AiProposalListSDO struct {
	Proposals []AiProposalDTO `json:"proposals" description:"Mọi dòng của câu trả lời theo position, ở trạng thái sau lần gọi"`
}

// AskUniModeSDO is PUT /api/v1/me/ask-uni-mode.
type AskUniModeSDO struct {
	Mode string `json:"mode" example:"plan"`
}

// AskWritePolicySDO is GET and PUT /api/v1/orgs/{org}/ai/ask-write-policy.
type AskWritePolicySDO struct {
	Ceiling string `json:"ceiling" description:"off, ask, plan hoặc auto; chưa đặt thì plan" example:"plan"`
}

// AiMemoryCapsDTO is Ask UNI's memory state for the caller.
type AiMemoryCapsDTO struct {
	Enabled bool `json:"enabled" description:"Cờ ask_uni_memory bật và lượt hỏi chạy agent; false thì client ẩn mọi thứ về bộ nhớ" example:"true"`
	On      bool `json:"on" description:"Công tắc Dùng bộ nhớ của người gọi (users.ask_uni_memory_off đảo lại)" example:"true"`
}

// AiMemoryDTO is one entry of the caller's memory.
type AiMemoryDTO struct {
	ID        string `json:"id" example:"01K4AIMEM0000000000000001"`
	Kind      string `json:"kind" description:"preference (cách UNI trả lời) hoặc fact (về bạn)" example:"fact"`
	Text      string `json:"text" description:"Một dòng, 1–300 ký tự" example:"Tôi làm ở phòng kinh doanh"`
	Source    string `json:"source" description:"manual, chat hoặc import" example:"manual"`
	CreatedAt string `json:"created_at" example:"2026-10-24T09:00:00Z"`
	UpdatedAt string `json:"updated_at" example:"2026-10-24T09:00:00Z"`
}

// AiMemoryListSDO is GET /api/v1/orgs/{org}/ai/memory.
type AiMemoryListSDO struct {
	Entries   []AiMemoryDTO `json:"entries" description:"Mục của người gọi trong tổ chức, cách trả lời trước, rồi mới nhất trước"`
	On        bool          `json:"on" description:"Công tắc Dùng bộ nhớ của người gọi" example:"true"`
	Limit     int           `json:"limit" description:"Số mục tối đa" example:"50"`
	Remaining int           `json:"remaining" description:"Số mục còn thêm được" example:"49"`
}

// AiMemoryClearSDO is DELETE /api/v1/orgs/{org}/ai/memory.
type AiMemoryClearSDO struct {
	Deleted int64 `json:"deleted" description:"Số mục đã xóa" example:"3"`
}
