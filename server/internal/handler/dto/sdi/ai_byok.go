package sdi

// The BYOK proxy bodies are the vendor's own wire format, forwarded
// unchanged (UNI-1008, ADR 0029). These types document the fields the
// server reads; every other field passes through as sent.

// AiByokChatCompletionsSDI is POST /api/v1/orgs/{orgID}/ai/byok/{aiProvider}/chat/completions.
type AiByokChatCompletionsSDI struct {
	Model    string `json:"model" minLength:"1" description:"Mã model của nhà cung cấp; ghi vào nhật ký sử dụng" example:"gpt-5.6-terra"`
	Stream   bool   `json:"stream" description:"true: trả SSE nguyên văn từ nhà cung cấp" example:"true"`
	Messages []any  `json:"messages" description:"Thân OpenAI Chat Completions nguyên bản (tools, ảnh, stream_options… đều chuyển tiếp)"`
}

// AiByokMessagesSDI is POST /api/v1/orgs/{orgID}/ai/byok/{aiProvider}/messages.
type AiByokMessagesSDI struct {
	Model     string `json:"model" minLength:"1" description:"Mã model Anthropic" example:"claude-sonnet-5"`
	Stream    bool   `json:"stream" description:"true: trả SSE nguyên văn" example:"true"`
	MaxTokens int    `json:"max_tokens" description:"Thân Anthropic Messages nguyên bản; mọi trường khác chuyển tiếp" example:"4096"`
	Messages  []any  `json:"messages"`
}

// AiByokGenerateSDI is POST /api/v1/orgs/{orgID}/ai/byok/{aiProvider}/generate.
type AiByokGenerateSDI struct {
	Model   string         `json:"model" minLength:"1" maxLength:"128" pattern:"^[A-Za-z0-9][A-Za-z0-9._-]*$" description:"Mã model Gemini (một đoạn đường dẫn)" example:"gemini-3.8-flash"`
	Stream  bool           `json:"stream" description:"true: streamGenerateContent?alt=sse; false: generateContent" example:"true"`
	Request map[string]any `json:"request" description:"Thân GenerateContentRequest nguyên bản của Gemini"`
}
