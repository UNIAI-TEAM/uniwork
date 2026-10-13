package ai

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
)

// UniWork AI façade (G6-03a, plan §5.4): the openai-compatible surface the
// Office panes speak, translated to and from the Gateway. This file owns the
// wire shapes, the allowlist filter, the caps of G6-D1 A6/A7 and the
// one-chunk SSE contract of A14. It never imports internal/service: the
// caller passes the transcript, the allowlist and the actor in.
//
// Wire (G6-D1): the request is openai-compatible ('messages', 'tools',
// 'stream'); the answer is a chat.completion object, or, when the client
// asked to stream, one 'chat.completion.chunk' carrying everything plus
// 'data: [DONE]'. The x_uniwork extension (A13) rides both; the conversation
// id is a response header (A12) the handler sets from the store. Errors are
// real HTTP statuses with the JSON error envelope: v1 never opens a 200 to
// report a failure (A14).
//
// Scaffolded entry points return errUniworkFacadeTODO until S1 fills them in
// (design: reports/g6-ai_server/g6-03a-design.md §6).

// Caps and wire constants of G6-D1.
const (
	// UniworkToolResultMaxBytes is A6: one tool result, decoded.
	UniworkToolResultMaxBytes = 64 << 10
	// UniworkToolResultsMaxBytes is A6: every tool result in one request.
	UniworkToolResultsMaxBytes = 256 << 10
	// UniworkHistoryMaxTokens is A7: estimated tokens per model call
	// (system + transcript + the new tool results), chars/4.
	UniworkHistoryMaxTokens = 48_000
	// UniworkMaxUserTurns is A7: user turns kept per conversation.
	UniworkMaxUserTurns = 20
	// UniworkQuestionMaxRunes is the largest single user question.
	UniworkQuestionMaxRunes = 8000
	// UniworkToolStepLimit is A3's cap of tool-result rounds per run. G6-03b
	// counts the run; the façade only reports step/limit in x_uniwork.
	UniworkToolStepLimit = 8

	// UniworkConversationHeader is A12; the server issues it and the client
	// sends it back. G6-03a emits and checks it.
	UniworkConversationHeader = "X-UniWork-AI-Conversation"
	// UniworkRunHeader is A12 too; G6-03b owns issuing and checking it.
	UniworkRunHeader = "X-UniWork-AI-Run"
)

// Reasons a model call is dropped from an answer (A13, security rule 6).
const (
	UniworkDropViewOnly       = "view_only"
	UniworkDropNotAllowlisted = "not_allowlisted"
)

// Errors the façade answers with. Codes come from contract-p0 §4 and travel
// to the client through the handler's error mapping.
var (
	errUniworkFacadeTODO = errors.New("ai: openai_facade scaffold, not implemented until G6-03a S1")

	// ErrUniworkClientRole is security rule 1: the client may not send role
	// system or developer; the server owns the system prompt.
	ErrUniworkClientRole = &Error{Code: "invalid_request", Status: http.StatusBadRequest,
		Msg: "vai trò system/developer không được gửi từ client"}
	// ErrUniworkInvalidTurn is a turn the server's transcript cannot answer
	// (rule 2: an unknown tool_call_id; a shape it never sent).
	ErrUniworkInvalidTurn = &Error{Code: "invalid_request", Status: http.StatusBadRequest,
		Msg: "lượt gửi lên không khớp hội thoại của server"}
	// ErrUniworkToolResultTooLarge is A6: a tool result over its cap (per
	// result or per request).
	ErrUniworkToolResultTooLarge = &Error{Code: "ai_tool_result_too_large", Status: http.StatusRequestEntityTooLarge,
		Msg: "vùng dữ liệu quá lớn để AI xử lý một lần"}
)

// UniworkChatRequest is the client body of one call, decoded from the raw
// JSON the handler reads. Only one turn arrives per request: the newest user
// question, or the tool results of the call the server just made.
type UniworkChatRequest struct {
	// Model, Temperature and MaxTokens are accepted and ignored: the server
	// policy decides (A1, spike §4.1).
	Model       string            `json:"model"`
	Messages    []UniworkMessage  `json:"messages"`
	Tools       []UniworkToolSpec `json:"tools,omitempty"`
	Stream      bool              `json:"stream,omitempty"`
	Temperature *float64          `json:"temperature,omitempty"`
	MaxTokens   *int              `json:"max_tokens,omitempty"`
	// Module names the genoffice module on the org route (a local file, S10)
	// only; on the document routes the server derives it and ignores this.
	Module string `json:"module,omitempty"`
}

// UniworkMessage is one message of the wire. Role user carries a question,
// role tool a result with the ToolCallID the server issued; role assistant
// (and its ToolCalls) is ignored: the server's transcript is what reaches
// the model (rule 7).
type UniworkMessage struct {
	Role       string            `json:"role"`
	Content    string            `json:"content"`
	ToolCalls  []UniworkToolCall `json:"tool_calls,omitempty"`
	ToolCallID string            `json:"tool_call_id,omitempty"`
}

// UniworkToolCall is one call, echoed by the assistant or sent back inside a
// tool result. Index is the position in the turn (A13: every tool_calls
// element of the answer carries it).
type UniworkToolCall struct {
	Index    int                 `json:"index"`
	ID       string              `json:"id"`
	Type     string              `json:"type"`
	Function UniworkToolFunction `json:"function"`
}

// UniworkToolFunction is what the model asked for: a name and its arguments
// as a JSON string, unchanged both ways.
type UniworkToolFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

// UniworkToolSpec is one tool the client offers; the server intersects the
// list with its module table before the model sees it.
type UniworkToolSpec struct {
	Type     string                  `json:"type"`
	Function UniworkToolSpecFunction `json:"function"`
}

// UniworkToolSpecFunction is the schema of one offered tool.
type UniworkToolSpecFunction struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

// UniworkAllowlist is the module's server-side tool set for one turn. Tools
// are the tools the model may call, in the shape the Gateway relays to the
// vendor (name, description, schema); WriteNames are the module's write
// tools, which never reach the model while ViewOnly is set (rule 6), so a
// call for one of them is reported as view_only rather than not_allowlisted.
type UniworkAllowlist struct {
	Tools      Registry
	WriteNames []string
	ViewOnly   bool
}

// UniworkTurn is one validated incoming turn: either a question or the tool
// results answering the server's last call.
type UniworkTurn struct {
	// Question is the user's new question text (UTF-8, bounded by
	// UniworkQuestionMaxRunes).
	Question string
	// ToolResults answer the last assistant turn, one message per call, in
	// call order; ToolResultTurn is then true.
	ToolResults []provider.Message
	// Tools are the client's tools, already intersected with the module's
	// server table.
	Tools  []UniworkToolSpec
	Stream bool
	// ToolResultTurn tells the Gateway to send the history as is instead of
	// rendering the prompt as a final user message.
	ToolResultTurn bool
}

// UniworkDroppedToolCall is one call the server refused to hand to the
// client, with its A13 reason.
type UniworkDroppedToolCall struct {
	Index  int    `json:"index"`
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

// UniworkExtension is x_uniwork (A13).
type UniworkExtension struct {
	DroppedToolCalls []UniworkDroppedToolCall `json:"dropped_tool_calls,omitempty"`
	Step             int                      `json:"step,omitempty"`
	Limit            int                      `json:"limit,omitempty"`
	// Terminal is signed and reserved: the server never emits it in v1; it
	// exists so G6-05 can already read it (A14).
	Terminal *UniworkTerminal `json:"terminal,omitempty"`
}

// UniworkTerminal is the reserved end-of-stream frame (A14).
type UniworkTerminal struct {
	Code       string `json:"code"`
	RetryAfter int    `json:"retry_after,omitempty"`
}

// UniworkAssistant is role "assistant" as the client sees it.
type UniworkAssistant struct {
	Role      string            `json:"role"`
	Content   string            `json:"content"`
	ToolCalls []UniworkToolCall `json:"tool_calls,omitempty"`
}

// UniworkUsage is the token block when the vendor reported one.
type UniworkUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// UniworkChoice is one entry of a chat.completion.
type UniworkChoice struct {
	Index        int              `json:"index"`
	Message      UniworkAssistant `json:"message"`
	FinishReason string           `json:"finish_reason"`
}

// UniworkChunkChoice is one entry of a chat.completion.chunk.
type UniworkChunkChoice struct {
	Index        int              `json:"index"`
	Delta        UniworkAssistant `json:"delta"`
	FinishReason string           `json:"finish_reason,omitempty"`
}

// UniworkChatCompletion is the non-stream answer.
type UniworkChatCompletion struct {
	ID       string            `json:"id"`
	Object   string            `json:"object"`
	Created  int64             `json:"created"`
	Model    string            `json:"model"`
	Choices  []UniworkChoice   `json:"choices"`
	Usage    *UniworkUsage     `json:"usage,omitempty"`
	XUniwork *UniworkExtension `json:"x_uniwork,omitempty"`
}

// UniworkChunk is the one SSE chunk of a streamed answer (A14).
type UniworkChunk struct {
	ID       string               `json:"id"`
	Object   string               `json:"object"`
	Created  int64                `json:"created"`
	Model    string               `json:"model"`
	Choices  []UniworkChunkChoice `json:"choices"`
	Usage    *UniworkUsage        `json:"usage,omitempty"`
	XUniwork *UniworkExtension    `json:"x_uniwork,omitempty"`
}

// UniworkResponseMeta is what the handler knows about the turn being written.
type UniworkResponseMeta struct {
	ConversationID string
	Model          string
	Step           int
	Limit          int
	Dropped        []UniworkDroppedToolCall
	Now            time.Time
}

// DecodeUniworkChatRequest parses the client body and refuses what rule 1
// forbids (role system/developer) before anything else looks at it.
func DecodeUniworkChatRequest(raw json.RawMessage) (UniworkChatRequest, error) {
	return UniworkChatRequest{}, errUniworkFacadeTODO
}

// PlanUniworkTurn validates one incoming request against the server's
// transcript: exactly one user question, or the tool results of the last
// assistant turn, with each tool_call_id issued by the server (rule 2); the
// caps of A6 (413) and A7; the client's tools intersected with allow.
func PlanUniworkTurn(transcript []provider.Message, raw json.RawMessage, allow UniworkAllowlist) (UniworkTurn, error) {
	return UniworkTurn{}, errUniworkFacadeTODO
}

// FilterUniworkToolCalls splits the model's calls into the ones the client
// may run and the ones the server drops, each with its A13 reason: a write
// tool while the caller may only view is view_only, anything else outside
// the allowlist is not_allowlisted. A dropped call never reaches tool_calls.
func FilterUniworkToolCalls(calls []provider.ToolCall, allow UniworkAllowlist) ([]provider.ToolCall, []UniworkDroppedToolCall) {
	return nil, nil
}

// NewUniworkChatCompletion builds the non-stream body from the Gateway's
// answer.
func NewUniworkChatCompletion(resp Response, meta UniworkResponseMeta) UniworkChatCompletion {
	return UniworkChatCompletion{}
}

// WriteUniworkSSE writes the one-chunk answer (A14): the 200 header is sent
// only once the Gateway has the upstream answer, then one full
// chat.completion.chunk and 'data: [DONE]'. It never opens a 200 for an
// error and never writes an empty stream.
func WriteUniworkSSE(w http.ResponseWriter, resp Response, meta UniworkResponseMeta) error {
	return errUniworkFacadeTODO
}
