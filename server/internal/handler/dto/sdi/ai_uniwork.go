package sdi

// AiUniworkChatCompletionsSDI is the body of the three UniWork AI routes
// (G6-03a): openai-compatible in, one turn per call. The handler reads the
// body as raw JSON and the façade parses it, so this type documents the wire
// for Swagger and the client. The server ignores model/temperature/
// max_tokens (its own policy decides, G6-D1 A1) and never reads history from
// messages: only the newest user question, or the tool results of the last
// call the server made, are used (security rule 7).
type AiUniworkChatCompletionsSDI struct {
	Model    string                `json:"model,omitempty" description:"Tên model; server bỏ qua, policy của server quyết (AI_MODEL_OFFICE_UNIWORK_AI)" example:"gpt-4o"`
	Messages []AiUniworkMessageSDI `json:"messages" minItems:"1" description:"Câu hỏi mới của người dùng (role user, đúng 1, message cuối) hoặc kết quả công cụ (role tool + tool_call_id) trả cho lượt assistant ngay trước của server. Lượt assistant do client gửi bị bỏ qua; role system/developer bị từ chối 400"`
	Tools    []AiUniworkToolSDI    `json:"tools,omitempty" description:"Công cụ editor của module đang mở; server giao với bảng công cụ của module, tên ngoài bảng không bao giờ tới model"`
	Stream   bool                  `json:"stream,omitempty" description:"true → SSE một chunk rồi [DONE] (G6-D1 A14); mọi lỗi trước byte đầu là HTTP status thật, không bao giờ 200 rỗng" example:"true"`
	Module   string                `json:"module,omitempty" enum:"docs,sheets,slides,pdf,markdown,html" description:"Chỉ route phiên không có tài liệu (tệp cục bộ, S10): module genoffice để chọn instruction pack và kiểm cờ định dạng; route có tài liệu suy module từ tài liệu/token và bỏ qua trường này" example:"sheets"`

	Temperature float64 `json:"temperature,omitempty" description:"Bỏ qua; policy của server quyết (Temperature 0)" example:"0.3"`
	MaxTokens   int     `json:"max_tokens,omitempty" description:"Bỏ qua; policy của server quyết (MaxTokens 4096)" example:"4096"`
	ToolChoice  string  `json:"tool_choice,omitempty" description:"Bỏ qua; model luôn tự chọn công cụ" example:"auto"`
}

// AiUniworkMessageSDI is one message of the openai-compatible wire.
type AiUniworkMessageSDI struct {
	Role       string                 `json:"role" enum:"user,assistant,tool" description:"user: câu hỏi mới; tool: kết quả công cụ trả cho tool call của server; assistant: bị bỏ qua (server giữ transcript)" example:"user"`
	Content    string                 `json:"content" description:"Nội dung; với role tool là kết quả công cụ (≤ 64 KiB mỗi kết quả, ≤ 256 KiB một request, vượt trần 413 ai_tool_result_too_large)" example:"Ô A1 bằng 42."`
	ToolCalls  []AiUniworkToolCallSDI `json:"tool_calls,omitempty" description:"Chỉ có nghĩa ở role assistant; gửi lên bị bỏ qua — server không bao giờ đọc lượt assistant của client"`
	ToolCallID string                 `json:"tool_call_id,omitempty" description:"Bắt buộc với role tool: id tool call của lượt assistant ngay trước, do server cấp; id lạ/lượt không khớp → 400 invalid_request" example:"call_abc"`
}

// AiUniworkToolCallSDI is one tool call as echoed on the wire.
type AiUniworkToolCallSDI struct {
	Index    int                      `json:"index" description:"Vị trí trong lượt; mọi phần tử tool_calls của câu trả lời đều có" example:"0"`
	ID       string                   `json:"id" description:"Id do server cấp cho tool call" example:"call_abc"`
	Type     string                   `json:"type" enum:"function" example:"function"`
	Function AiUniworkToolFunctionSDI `json:"function"`
}

// AiUniworkToolFunctionSDI is the name and arguments of one call.
type AiUniworkToolFunctionSDI struct {
	Name      string `json:"name" description:"Tên công cụ" example:"set_cell"`
	Arguments string `json:"arguments" description:"Tham số JSON dạng chuỗi, giữ nguyên hai chiều" example:"{\"cell\":\"A1\",\"value\":42}"`
}

// AiUniworkToolSDI is one tool the pane offers.
type AiUniworkToolSDI struct {
	Type     string                       `json:"type" enum:"function" example:"function"`
	Function AiUniworkToolSpecFunctionSDI `json:"function"`
}

// AiUniworkToolSpecFunctionSDI is the schema of one offered tool; the model
// is told only what the server allowed through.
type AiUniworkToolSpecFunctionSDI struct {
	Name        string         `json:"name" description:"Tên công cụ của module" example:"get_cell"`
	Description string         `json:"description" description:"Mô tả cho model" example:"Đọc giá trị của một ô"`
	Parameters  map[string]any `json:"parameters" description:"JSON Schema tham số của công cụ" example:"{\"type\":\"object\",\"properties\":{\"cell\":{\"type\":\"string\"}}}"`
}
