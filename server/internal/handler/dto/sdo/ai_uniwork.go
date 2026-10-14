package sdo

// AiUniworkChatCompletionsSDO is the non-stream answer of the UniWork AI
// routes (G6-03a): an openai-compatible chat.completion. With stream=true the
// same fields travel as one chat.completion.chunk followed by [DONE] (see
// AiUniworkChunkSDO); the handler writes both, this type documents the shape
// for Swagger and the client (G6-D1 A13/A14).
type AiUniworkChatCompletionsSDO struct {
	ID       string                 `json:"id" description:"Id của lượt (ULID) do server cấp" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	Object   string                 `json:"object" example:"chat.completion"`
	Created  int64                  `json:"created" description:"Unix giây" example:"1791800000"`
	Model    string                 `json:"model" description:"Model policy đã dùng" example:"gpt-4o"`
	Choices  []AiUniworkChoiceSDO   `json:"choices"`
	Usage    *AiUniworkUsageSDO     `json:"usage,omitempty" description:"Có khi nhà cung cấp trả usage; thiếu → G6-03b ghi usage_unknown"`
	XUniwork *AiUniworkExtensionSDO `json:"x_uniwork,omitempty" description:"Phần mở rộng của UniWork (A13): call bị lọc, số vòng, trần"`
}

// AiUniworkChoiceSDO is one choice of the answer.
type AiUniworkChoiceSDO struct {
	Index        int                   `json:"index" example:"0"`
	Message      AiUniworkAssistantSDO `json:"message"`
	FinishReason string                `json:"finish_reason" description:"stop | tool_calls | length; không bao giờ tool_not_allowed" example:"tool_calls"`
}

// AiUniworkAssistantSDO is the message the model produced.
type AiUniworkAssistantSDO struct {
	Role      string                 `json:"role" example:"assistant"`
	Content   string                 `json:"content" example:"Ô A1 bằng 42."`
	ToolCalls []AiUniworkToolCallSDO `json:"tool_calls,omitempty" description:"Chỉ còn những call nằm trong allowlist; call bị bỏ đi qua x_uniwork.dropped_tool_calls"`
}

// AiUniworkToolCallSDO is one tool call handed to the client.
type AiUniworkToolCallSDO struct {
	Index    int                      `json:"index" example:"0"`
	ID       string                   `json:"id" description:"Id server cấp cho tool call; tool-result gửi lại đúng id này" example:"call_abc"`
	Type     string                   `json:"type" example:"function"`
	Function AiUniworkToolFunctionSDO `json:"function"`
}

// AiUniworkToolFunctionSDO is the name and arguments of one call.
type AiUniworkToolFunctionSDO struct {
	Name      string `json:"name" example:"set_cell"`
	Arguments string `json:"arguments" description:"Tham số JSON dạng chuỗi" example:"{\"cell\":\"A1\",\"value\":42}"`
}

// AiUniworkUsageSDO is the token block when the vendor reported one.
type AiUniworkUsageSDO struct {
	PromptTokens     int `json:"prompt_tokens" example:"1234"`
	CompletionTokens int `json:"completion_tokens" example:"56"`
	TotalTokens      int `json:"total_tokens" example:"1290"`
}

// AiUniworkDroppedToolCallSDO is one model call the server refused to hand
// over (A13). A dropped call is never in tool_calls.
type AiUniworkDroppedToolCallSDO struct {
	Index  int    `json:"index" example:"1"`
	Name   string `json:"name" example:"delete_sheet"`
	Reason string `json:"reason" enum:"view_only,not_allowlisted" description:"view_only: công cụ ghi khi người dùng chỉ còn quyền xem (luật 6); not_allowlisted: ngoài allowlist của module" example:"view_only"`
}

// AiUniworkExtensionSDO is x_uniwork (A13).
type AiUniworkExtensionSDO struct {
	DroppedToolCalls []AiUniworkDroppedToolCallSDO `json:"dropped_tool_calls,omitempty"`
	Step             int                           `json:"step" description:"Số vòng tool đã dùng trong run (G6-03b đếm)" example:"3"`
	Limit            int                           `json:"limit" description:"Trần vòng tool mỗi run (G6-D1 A3: 8)" example:"8"`
	Terminal         *AiUniworkTerminalSDO         `json:"terminal,omitempty" description:"Dành sẵn cho v1.1; server v1 (SSE một chunk) không bao giờ phát"`
}

// AiUniworkTerminalSDO is the reserved end-of-stream frame (A14): a final
// chunk carrying only x_uniwork.terminal, then [DONE]. G6-05 reads it from v1
// so real streaming can ship without a new app release.
type AiUniworkTerminalSDO struct {
	Code       string `json:"code" enum:"ai_rate_limited,ai_provider_error,ai_provider_timeout" example:"ai_rate_limited"`
	RetryAfter int    `json:"retry_after,omitempty" description:"Giây, chỉ với ai_rate_limited" example:"30"`
}

// AiUniworkChunkChoiceSDO is one entry of the streaming chunk.
type AiUniworkChunkChoiceSDO struct {
	Index        int                   `json:"index" example:"0"`
	Delta        AiUniworkAssistantSDO `json:"delta"`
	FinishReason string                `json:"finish_reason,omitempty" example:"stop"`
}

// AiUniworkChunkSDO is the one SSE chunk of a streamed answer (A14): a full
// chat.completion.chunk (role, content, tool_calls with index/id,
// finish_reason, x_uniwork, usage) followed by data: [DONE].
type AiUniworkChunkSDO struct {
	ID       string                    `json:"id" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	Object   string                    `json:"object" example:"chat.completion.chunk"`
	Created  int64                     `json:"created" example:"1791800000"`
	Model    string                    `json:"model" example:"gpt-4o"`
	Choices  []AiUniworkChunkChoiceSDO `json:"choices"`
	Usage    *AiUniworkUsageSDO        `json:"usage,omitempty"`
	XUniwork *AiUniworkExtensionSDO    `json:"x_uniwork,omitempty"`
}
