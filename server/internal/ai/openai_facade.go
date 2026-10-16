package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/util"
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
// (and its ToolCalls) is ignored: the server's transcript is what reaches the
// model (rule 7).
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
// Module is the turn's office pack module (the G6-14 names: xlsx, docx,
// pptx, pdf, md, html), the one the Gateway assembles its system text by and
// the A7 budget counts; empty when the turn's module is not one the pack
// knows, which the Gateway refuses before the usage row.
type UniworkAllowlist struct {
	Tools      Registry
	WriteNames []string
	ViewOnly   bool
	Module     string
}

// UniworkTurn is one validated incoming turn: either a question or the tool
// results answering the server's last call.
type UniworkTurn struct {
	// Question is the user's new question text (UTF-8, bounded by
	// UniworkQuestionMaxRunes). The office pack renders nothing, so it is
	// also the last message of History.
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
	// History is exactly what the Gateway must send (A7): the server
	// transcript trimmed to the 48 000-token budget by whole blocks, then the
	// turn's own message — the new question, or the new tool results. The
	// office pack renders nothing, so this History is the user side of the
	// model call and ends with a user message on a question turn. The caller
	// stores the turn's own message back, so the transcript stays "what the
	// model saw" (design §6.2).
	History []provider.Message
}

// UniworkDroppedToolCall is one call the server refused to hand to the
// client, with its A13 reason.
type UniworkDroppedToolCall struct {
	Index  int    `json:"index"`
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

// UniworkExtension is x_uniwork (A13). Step and Limit have no omitempty
// (G6-03b, BE3A-11): 0 is the first turn's real step and must be emitted;
// dropped_tool_calls and terminal are absent when they mean nothing.
type UniworkExtension struct {
	DroppedToolCalls []UniworkDroppedToolCall `json:"dropped_tool_calls,omitempty"`
	Step             int                      `json:"step"`
	Limit            int                      `json:"limit"`
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
// forbids (role system/developer) before anything else looks at it. It is
// also the shape gate: an empty turn and a role outside user/assistant/tool
// are 400 invalid_request, and a body that is not JSON is one too.
func DecodeUniworkChatRequest(raw json.RawMessage) (UniworkChatRequest, error) {
	var req UniworkChatRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return UniworkChatRequest{}, ErrUniworkInvalidTurn.wrap(err)
	}
	if len(req.Messages) == 0 {
		return UniworkChatRequest{}, ErrUniworkInvalidTurn.wrap(errors.New("không có message nào"))
	}
	for _, m := range req.Messages {
		switch m.Role {
		case "user", "assistant", "tool":
		case "system", "developer":
			return UniworkChatRequest{}, ErrUniworkClientRole
		default:
			return UniworkChatRequest{}, ErrUniworkInvalidTurn.wrap(fmt.Errorf("vai trò %q không được hỗ trợ", m.Role))
		}
	}
	return req, nil
}

// PlanUniworkTurn validates one incoming request against the server's
// transcript: exactly one user question, or the tool results of the last
// assistant turn, with each tool_call_id issued by the server (rule 2); the
// caps of A6 (413) and A7; the client's tools intersected with allow. The
// turn's own message joins the History the Gateway sends: the office pack
// (G6-14) renders nothing, so the question is the last user message there.
func PlanUniworkTurn(transcript []provider.Message, raw json.RawMessage, allow UniworkAllowlist) (UniworkTurn, error) {
	req, err := DecodeUniworkChatRequest(raw)
	if err != nil {
		return UniworkTurn{}, err
	}
	turn := UniworkTurn{Stream: req.Stream, Tools: uniworkOfferedTools(req.Tools, allow)}

	switch newest := req.Messages[len(req.Messages)-1]; newest.Role {
	case "tool":
		results, err := uniworkToolResults(transcript, req.Messages)
		if err != nil {
			return UniworkTurn{}, err
		}
		turn.ToolResults = results
		turn.ToolResultTurn = true
		history, err := uniworkHistory(transcript, results, true, allow.Module)
		if err != nil {
			return UniworkTurn{}, err
		}
		turn.History = history
	case "user":
		for _, m := range req.Messages[:len(req.Messages)-1] {
			if m.Role == "tool" {
				return UniworkTurn{}, ErrUniworkInvalidTurn.wrap(errors.New("kết quả công cụ và câu hỏi không đi chung một lượt"))
			}
		}
		if err := uniworkValidateQuestion(newest.Content); err != nil {
			return UniworkTurn{}, err
		}
		turn.Question = newest.Content
		history, err := uniworkHistory(transcript, []provider.Message{{Role: "user", Content: newest.Content}}, false, allow.Module)
		if err != nil {
			return UniworkTurn{}, err
		}
		turn.History = history
	default:
		return UniworkTurn{}, ErrUniworkInvalidTurn.wrap(errors.New("lượt mới phải là câu hỏi hoặc kết quả công cụ"))
	}
	return turn, nil
}

// FilterUniworkToolCalls splits the model's calls into the ones the client
// may run and the ones the server drops, each with its A13 reason: a write
// tool while the caller may only view is view_only, anything else outside
// the allowlist is not_allowlisted. A dropped call never reaches tool_calls.
func FilterUniworkToolCalls(calls []provider.ToolCall, allow UniworkAllowlist) ([]provider.ToolCall, []UniworkDroppedToolCall) {
	if len(calls) == 0 {
		return nil, nil
	}
	writes := uniworkNameSet(allow.WriteNames)
	kept := make([]provider.ToolCall, 0, len(calls))
	var dropped []UniworkDroppedToolCall
	for i, c := range calls {
		if _, ok := allow.Tools.Get(c.Name); ok {
			kept = append(kept, c)
			continue
		}
		reason := UniworkDropNotAllowlisted
		if allow.ViewOnly && writes[c.Name] {
			reason = UniworkDropViewOnly
		}
		dropped = append(dropped, UniworkDroppedToolCall{Index: i, Name: c.Name, Reason: reason})
	}
	return kept, dropped
}

// NewUniworkChatCompletion builds the non-stream body from the Gateway's
// answer.
func NewUniworkChatCompletion(resp Response, meta UniworkResponseMeta) UniworkChatCompletion {
	msg := uniworkAssistant(resp, meta)
	return UniworkChatCompletion{
		ID: uniworkCompletionID(resp), Object: "chat.completion", Created: uniworkCreated(meta), Model: uniworkModel(resp, meta),
		Choices: []UniworkChoice{{Index: 0, Message: msg, FinishReason: uniworkFinishReason(msg)}},
		Usage:   uniworkUsage(resp), XUniwork: uniworkExtension(meta),
	}
}

// WriteUniworkSSE writes the one-chunk answer (A14): the 200 header is sent
// only once the Gateway has the upstream answer, then one full
// chat.completion.chunk and 'data: [DONE]'. It never opens a 200 for an
// error and never writes an empty stream; a write that fails is returned to
// the caller, so a broken stream is never silent.
func WriteUniworkSSE(w http.ResponseWriter, resp Response, meta UniworkResponseMeta) error {
	msg := uniworkAssistant(resp, meta)
	chunk := UniworkChunk{
		ID: uniworkCompletionID(resp), Object: "chat.completion.chunk", Created: uniworkCreated(meta), Model: uniworkModel(resp, meta),
		Choices: []UniworkChunkChoice{{Index: 0, Delta: msg, FinishReason: uniworkFinishReason(msg)}},
		Usage:   uniworkUsage(resp), XUniwork: uniworkExtension(meta),
	}
	payload, err := json.Marshal(chunk)
	if err != nil {
		return err
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(append([]byte("data: "), append(payload, '\n', '\n')...)); err != nil {
		return err
	}
	flush(w)
	if _, err := w.Write([]byte("data: [DONE]\n\n")); err != nil {
		return err
	}
	flush(w)
	return nil
}

func flush(w http.ResponseWriter) {
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

// ---- the incoming turn ------------------------------------------------------

// uniworkOfferedTools intersects what the client offered with the allowlist:
// a name outside the server's table never reaches the model. While ViewOnly
// the module's write tools are withheld even when the caller left one in
// Tools; an empty intersection sends no tool at all and the model answers.
func uniworkOfferedTools(offered []UniworkToolSpec, allow UniworkAllowlist) []UniworkToolSpec {
	writes := uniworkNameSet(allow.WriteNames)
	seen := make(map[string]bool, len(offered))
	out := make([]UniworkToolSpec, 0, len(offered))
	for _, spec := range offered {
		name := spec.Function.Name
		if name == "" || seen[name] {
			continue
		}
		if _, ok := allow.Tools.Get(name); !ok {
			continue
		}
		if allow.ViewOnly && writes[name] {
			continue
		}
		seen[name] = true
		out = append(out, spec)
	}
	return out
}

// uniworkValidateQuestion bounds the new question (spike §4.6) and refuses an
// empty one: a turn must carry something to answer.
func uniworkValidateQuestion(question string) error {
	if strings.TrimSpace(question) == "" {
		return ErrUniworkInvalidTurn.wrap(errors.New("câu hỏi rỗng"))
	}
	if utf8.RuneCountInString(question) > UniworkQuestionMaxRunes {
		return ErrUniworkInvalidTurn.wrap(fmt.Errorf("câu hỏi dài hơn %d ký tự", UniworkQuestionMaxRunes))
	}
	return nil
}

// uniworkToolResults validates the client's tail of tool messages against the
// server's last assistant turn (rule 2: every result answers a call the
// server issued, exactly once, every call answered) and returns them in call
// order, so the vendor sees each result paired with its call. The caps of A6
// are checked first: a body over them is 413 whatever its ids look like.
func uniworkToolResults(transcript []provider.Message, msgs []UniworkMessage) ([]provider.Message, error) {
	start := len(msgs)
	for start > 0 && msgs[start-1].Role == "tool" {
		start--
	}
	for _, m := range msgs[:start] {
		if m.Role == "tool" {
			return nil, ErrUniworkInvalidTurn.wrap(errors.New("kết quả công cụ không nằm liền nhau ở cuối lượt"))
		}
	}
	total := 0
	for _, m := range msgs[start:] {
		if len(m.Content) > UniworkToolResultMaxBytes {
			return nil, ErrUniworkToolResultTooLarge
		}
		if total += len(m.Content); total > UniworkToolResultsMaxBytes {
			return nil, ErrUniworkToolResultTooLarge
		}
	}
	if len(transcript) == 0 {
		return nil, ErrUniworkInvalidTurn.wrap(errors.New("server chưa gọi công cụ nào"))
	}
	last := transcript[len(transcript)-1]
	if last.Role != "assistant" || len(last.ToolCalls) == 0 {
		return nil, ErrUniworkInvalidTurn.wrap(errors.New("lượt cuối của server không phải lượt gọi công cụ"))
	}
	position := make(map[string]int, len(last.ToolCalls))
	for i, c := range last.ToolCalls {
		if c.ID == "" {
			return nil, ErrUniworkInvalidTurn.wrap(errors.New("lượt gọi công cụ của server thiếu id"))
		}
		if _, dup := position[c.ID]; dup {
			return nil, ErrUniworkInvalidTurn.wrap(errors.New("lượt gọi công cụ của server lặp id"))
		}
		position[c.ID] = i
	}
	out := make([]provider.Message, len(last.ToolCalls))
	answered := make([]bool, len(last.ToolCalls))
	for _, m := range msgs[start:] {
		i, ok := position[m.ToolCallID]
		if !ok {
			return nil, ErrUniworkInvalidTurn.wrap(fmt.Errorf("kết quả công cụ %q không trả lời lượt gọi nào của server", m.ToolCallID))
		}
		if answered[i] {
			return nil, ErrUniworkInvalidTurn.wrap(fmt.Errorf("kết quả công cụ %q gửi hai lần", m.ToolCallID))
		}
		answered[i] = true
		out[i] = provider.Message{Role: "tool", ToolCallID: m.ToolCallID, Content: m.Content}
	}
	for _, ok := range answered {
		if !ok {
			return nil, ErrUniworkInvalidTurn.wrap(errors.New("thiếu kết quả cho một công cụ đã gọi"))
		}
	}
	return out, nil
}

// ---- the A7 history budget --------------------------------------------------

// uniworkHistory returns exactly what the Gateway must send for this turn:
// the server transcript trimmed to A7's budget, then next — the new question
// or the new tool results, which are never dropped. The budget counts the
// system text the Gateway will assemble for the turn's module (G6-14's pack)
// and every message that reaches the model, next included. Trimming is silent
// and drops whole blocks, oldest first, so a tool result never survives
// without the call it answers; only a tool-result turn that cannot fit even
// after everything else was dropped is refused (413, design §5 — never cut
// inside a tool result, and a question turn is never refused).
func uniworkHistory(transcript, next []provider.Message, toolTurn bool, module string) ([]provider.Message, error) {
	system := uniworkSystemPrompt(module)
	budget := UniworkHistoryMaxTokens
	blocks := uniworkBlocks(transcript)
	tokens := uniworkHistoryTokens(system, transcript) + uniworkHistoryTokens("", next)
	dropped := 0
	for dropped < len(blocks) && tokens > budget {
		if toolTurn && dropped == len(blocks)-1 {
			// The block the new results answer must stay; there is nothing
			// left to cut.
			break
		}
		tokens -= uniworkHistoryTokens("", blocks[dropped])
		dropped++
	}
	if toolTurn && tokens > budget {
		return nil, ErrUniworkToolResultTooLarge
	}
	var kept []provider.Message
	for _, b := range blocks[dropped:] {
		kept = append(kept, b...)
	}
	if len(next) == 0 {
		return kept, nil
	}
	return append(kept, next...), nil
}

// uniworkBlocks splits a transcript into whole turn blocks: each starts at a
// user message, and anything before the first user message is one leading
// block. Dropping a block therefore drops a question with every assistant
// call and tool result that answered it, and never leaves an orphan result.
func uniworkBlocks(msgs []provider.Message) [][]provider.Message {
	var blocks [][]provider.Message
	start := 0
	for i, m := range msgs {
		if i > start && m.Role == "user" {
			blocks = append(blocks, msgs[start:i])
			start = i
		}
	}
	if start < len(msgs) {
		blocks = append(blocks, msgs[start:])
	}
	return blocks
}

// uniworkHistoryTokens is the A7 estimate of one model call's input: the
// system text plus every message (content, tool ids, and each call's id, name
// and arguments), counted with the package's chars/4 rule like the context
// budget. Parts do not occur on this path (no media in a UniWork AI turn).
func uniworkHistoryTokens(system string, msgs []provider.Message) int {
	tokens := estimateTokens(system)
	for _, m := range msgs {
		tokens += estimateTokens(m.Content) + estimateTokens(m.ToolCallID)
		for _, c := range m.ToolCalls {
			tokens += estimateTokens(c.ID) + estimateTokens(c.Name) + estimateTokens(string(c.Input))
		}
	}
	return tokens
}

// uniworkSystemPrompt is the system text the Gateway assembles for this turn:
// the office pack's variant for the turn's module (G6-14). The A7 budget must
// leave room for it — it is the one part of the model call no client message
// carries. A module the pack does not know answers "" here: the Gateway
// refuses such a turn itself, before the usage row.
func uniworkSystemPrompt(module string) string {
	text, err := OfficeSystemPrompt(module)
	if err != nil {
		return ""
	}
	return text
}

// ---- the outgoing answer ----------------------------------------------------

// uniworkAssistant turns the Gateway's answer into the wire's assistant
// message. Every call the server dropped (meta.Dropped) is left out even when
// the caller passes the vendor's whole list in: A13's invariant holds inside
// the façade too. Index stays the call's position in the vendor's answer, so
// the client can line it up with a dropped_tool_calls entry.
func uniworkAssistant(resp Response, meta UniworkResponseMeta) UniworkAssistant {
	skipped := make(map[int]string, len(meta.Dropped))
	for _, d := range meta.Dropped {
		skipped[d.Index] = d.Name
	}
	out := UniworkAssistant{Role: "assistant", Content: resp.Text}
	for i, c := range resp.ToolCalls {
		if name, ok := skipped[i]; ok && name == c.Name {
			continue
		}
		out.ToolCalls = append(out.ToolCalls, uniworkToolCall(i, c))
	}
	return out
}

// uniworkToolCall is one call as the client reads it. Arguments is the
// vendor's JSON string, and an empty one becomes "{}" so a client that parses
// every tool call does not fail on an empty string.
func uniworkToolCall(i int, c provider.ToolCall) UniworkToolCall {
	args := strings.TrimSpace(string(c.Input))
	if args == "" {
		args = "{}"
	}
	return UniworkToolCall{Index: i, ID: c.ID, Type: "function", Function: UniworkToolFunction{Name: c.Name, Arguments: args}}
}

// uniworkFinishReason is the standard value A13 signs: tool_calls when at
// least one call survived the filter, stop otherwise. There is no
// tool_not_allowed value, ever.
func uniworkFinishReason(msg UniworkAssistant) string {
	if len(msg.ToolCalls) > 0 {
		return "tool_calls"
	}
	return "stop"
}

// uniworkExtension is x_uniwork. Step and limit default to the A3 cap so a
// caller that does not count rounds yet (G6-03b owns the real number) still
// reports the shape the fork reads; terminal stays nil in v1.
func uniworkExtension(meta UniworkResponseMeta) *UniworkExtension {
	limit := meta.Limit
	if limit <= 0 {
		limit = UniworkToolStepLimit
	}
	return &UniworkExtension{DroppedToolCalls: meta.Dropped, Step: meta.Step, Limit: limit}
}

// uniworkUsage is the token block, present only when the vendor reported
// tokens: a zero block would claim nobody counted anything, and A16's
// usage_unknown is G6-03b's reading of the row.
func uniworkUsage(resp Response) *UniworkUsage {
	if resp.InputTokens <= 0 && resp.OutputTokens <= 0 {
		return nil
	}
	return &UniworkUsage{PromptTokens: resp.InputTokens, CompletionTokens: resp.OutputTokens, TotalTokens: resp.InputTokens + resp.OutputTokens}
}

// uniworkCompletionID names the answer: the usage row's id where there is one
// (a ULID), a fresh one otherwise, so the wire always carries an id.
func uniworkCompletionID(resp Response) string {
	if resp.UsageEventID != "" {
		return resp.UsageEventID
	}
	return util.NewID()
}

func uniworkCreated(meta UniworkResponseMeta) int64 {
	now := meta.Now
	if now.IsZero() {
		now = time.Now()
	}
	return now.Unix()
}

func uniworkModel(resp Response, meta UniworkResponseMeta) string {
	if resp.Model != "" {
		return resp.Model
	}
	return meta.Model
}

// ---- the interim module tool table (design §6.5, D-2) -----------------------

// uniworkModuleTools is one module of the interim table: the tool names the
// module reads with and the ones it writes with. Write names drive rule 6: a
// write tool never reaches the model while the caller may only view, and a
// call for one is reported as view_only rather than not_allowlisted.
type uniworkModuleTools struct {
	Read  []string
	Write []string
}

// officeUniworkModulesV1 is version 1 of the interim per-module tool table
// (design §6.5, D-2): the only place that decides read versus write, so the
// tools a turn is offered are the intersection of the client's tools with it,
// and an unknown or missing module (the org route without `module`, a name no
// table knows) yields no tools at all. Names and the read/write split come
// from docs/office/g5g6g7/genoffice-tools.md §3, the mechanical block
// generated at fork rev 3e4e9b71fb08682f8afbe5cc0c2045792d14fd3b (extract
// sha256 235ceb7a82b5c0d3a11315314eb6dbf68de2d6cbedf29f12aace8fb4599e9b95):
// every editor_write=yes row, plus the four group-B rows the document lists
// as writing files or creating versions (create_document in docs, sheets and
// pdf, save_style_template in slides), minus the five slides rows G6-09a
// removes below. G6-01/G6-12 replace the contents when the mechanical table
// lands; the mechanism and its tests stay.
//
// G6-09a (N1) takes the five slides tools the client never offers under
// UniWork AI out of the table again — generate_deck, regenerate_slide,
// insert_web_image, replace_image, save_style_template (the slides skill hides
// them whenever the provider is UniWork AI) — so a modified client cannot
// offer them and a call for one is dropped as not_allowlisted. What stays on
// purpose: create_document (docs, sheets, pdf) and the pdf file-level page
// tools (insert_blank_page, set_page_size, crop_pages, replace_pages,
// extract_pages, split_pdf, split_pages, merge_pages). The clients hide those
// only for a UniWork-bound document (policy Q3, Q4), but the table is keyed by
// module alone and carries no document scope; R1 (the local-file route) is
// viewOnly today, so the bound-only hides need the turn's document scope
// plumbed in — a g6-ai_server follow-up (the Advisor relayed it), not this
// lane's. The pdf text / image edit tools stay too: the client hides them by
// the host capability, which the server cannot read.
var officeUniworkModulesV1 = map[string]uniworkModuleTools{
	"docs": {
		Read: []string{
			"analyze_media", "ask_clarification", "generate_mindmap", "get_document_context", "image_search", "list_styles",
			"read_attachment", "read_blocks", "read_comments", "read_notes", "read_revisions", "web_search",
		},
		Write: []string{
			"accept_changes", "add_comment", "apply_ops", "create_document", "define_style", "delete_comment",
			"delete_note", "edit_chart", "edit_note", "generate_image", "insert_chart", "insert_content",
			"insert_endnote", "insert_footnote", "insert_image", "insert_picture", "insert_section_break",
			"insert_text_box", "reject_changes", "replace_blocks", "replace_selection", "reply_comment",
			"resolve_comment", "set_header_footer", "set_page_setup", "set_watermark", "write_document",
		},
	},
	"html": {
		Read:  []string{"ask_clarification", "get_outline", "read_attachment", "read_source", "web_search"},
		Write: []string{"apply_ops", "plan_page", "write_document"},
	},
	"markdown": {
		Read:  []string{"ask_clarification", "generate_mindmap", "get_document_context", "image_search", "read_blocks", "read_frontmatter", "web_search"},
		Write: []string{"apply_ops", "generate_image", "insert_image", "write_document"},
	},
	"pdf": {
		Read: []string{
			"ask_clarification", "generate_image", "get_outline", "goto_page", "image_search", "list_form_fields",
			"list_inserted_text", "list_page_images", "read_annotations", "read_pages", "search_text",
		},
		Write: []string{
			"add_form_mark", "add_note", "apply_ops", "create_document", "crop_image", "crop_pages", "delete_image",
			"delete_inserted_text", "delete_markup", "delete_note", "edit_block", "edit_inserted_text", "edit_note",
			"edit_text", "extract_pages", "flip_image", "insert_blank_page", "insert_image", "insert_text",
			"markup_text", "merge_pages", "move_inserted_text", "move_text_block", "remove_image_background",
			"replace_image", "replace_pages", "reply_note", "rotate_image", "set_header_footer", "set_image_opacity",
			"set_page_size", "set_watermark", "split_pages", "split_pdf", "transform_image",
		},
	},
	"sheets": {
		Read: []string{
			"aggregate_range", "ask_clarification", "compare_ranges", "find_cells", "generate_image",
			"get_workbook_context", "image_search", "load_guide", "read_attachment", "read_cells", "read_formats",
			"read_range", "read_sheet_features", "select_range", "summarize_range", "trace_dependents",
			"trace_precedents", "web_search",
		},
		Write: []string{"create_document", "merge_attached_workbooks", "propose_operations"},
	},
	"slides": {
		Read: []string{
			"analyze_media", "ask_clarification", "generate_image", "image_search", "list_style_templates",
			"load_guide", "plan_deck", "read_attachment", "read_slide", "web_search",
		},
		Write: []string{"apply_ops", "edit_chart", "execute_slide_script"},
	},
}

// uniworkPackModules maps a genoffice web module — the names this file's tool
// table and the Office frame token's claims use — to the module the office
// instruction pack (G6-14, prompts_office.go) assembles its System by: the
// module column of docs/office/g5g6g7/genoffice-tools.md, which names formats
// where the editors name editors (docs is docx, sheets is xlsx, slides is
// pptx, markdown is md).
var uniworkPackModules = map[string]string{
	"docs": "docx", "sheets": "xlsx", "slides": "pptx",
	"pdf": "pdf", "markdown": "md", "html": "html",
}

// UniworkPackModule names the office pack module of a genoffice web module;
// false for a name the pack carries no section for, which the Gateway refuses
// rather than defaulting to a section (G6-14 BE14-3).
func UniworkPackModule(module string) (string, bool) {
	pack, ok := uniworkPackModules[module]
	return pack, ok
}

// UniworkModuleAllowlist builds one turn's allowlist from the interim module
// table: the model may be offered a tool only when the client offered it AND
// the module table knows the name. While viewOnly the module's write tools
// are withheld (rule 6) but stay in WriteNames, so a call for one is reported
// view_only; an empty intersection offers no tool and the model answers in
// text. The registry entries carry the client's schema and description — the
// editor owns the tool shapes, the server owns the names. The allowlist also
// carries the turn's pack module, which the Gateway assembles the system text
// by and the A7 budget counts.
func UniworkModuleAllowlist(module string, offered []UniworkToolSpec, viewOnly bool) UniworkAllowlist {
	pack, _ := UniworkPackModule(module)
	mod, ok := officeUniworkModulesV1[module]
	if !ok {
		return UniworkAllowlist{ViewOnly: viewOnly, Module: pack}
	}
	read := uniworkNameSet(mod.Read)
	writes := uniworkNameSet(mod.Write)
	seen := make(map[string]bool, len(offered))
	allow := UniworkAllowlist{WriteNames: mod.Write, ViewOnly: viewOnly, Module: pack}
	for _, spec := range offered {
		name := spec.Function.Name
		if name == "" || seen[name] {
			continue
		}
		_, isRead := read[name]
		_, isWrite := writes[name]
		if !isRead && !(isWrite && !viewOnly) {
			continue
		}
		seen[name] = true
		allow.Tools = append(allow.Tools, uniworkRegistryTool(name, spec, isWrite))
	}
	return allow
}

// uniworkRegistryTool mirrors one client tool as the Gateway's registry entry:
// the name the server vetted, the editor's description and schema, and the
// kind/risk the table decided (risk lands in the usage row's tool_calls
// column).
func uniworkRegistryTool(name string, spec UniworkToolSpec, write bool) Tool {
	schema, err := json.Marshal(spec.Function.Parameters)
	if err != nil || len(schema) == 0 || string(schema) == "null" {
		schema = json.RawMessage(`{"type":"object"}`)
	}
	t := Tool{Name: name, Description: spec.Function.Description, Kind: ToolRead, Risk: RiskLow, Schema: schema}
	if write {
		t.Kind = ToolWrite
		t.Risk = RiskMedium
	}
	return t
}

func uniworkNameSet(names []string) map[string]bool {
	set := make(map[string]bool, len(names))
	for _, n := range names {
		set[n] = true
	}
	return set
}
