package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// BYOK pass-through proxy (UNI-1008, ADR 0029, contract D3): the web host
// speaks the vendor's own wire format to UniWork, the gateway swaps in the
// person's stored key and the vendor endpoint from the provider table, and
// the vendor's bytes come back unchanged — SSE stays SSE. Nothing here
// translates a body; it only reads the model name and the usage block for
// the meter row.

// CapOfficeBYOK is the usage-row capability of a proxied call. It has no
// model policy: the person picks the model and pays the vendor (credits 0).
const CapOfficeBYOK Capability = "office.byok"

// ProxyOp is the route the client called; each one belongs to one protocol.
type ProxyOp string

const (
	ProxyChatCompletions ProxyOp = "chat_completions" // openai-compatible
	ProxyMessages        ProxyOp = "messages"         // anthropic
	ProxyGenerate        ProxyOp = "generate"         // gemini
	ProxyModels          ProxyOp = "models"           // any
)

type ProxyRequest struct {
	Actor          audit.Actor
	OrganizationID string
	Credential     BYOKCredential
	Op             ProxyOp
	// Body is the vendor body for chat/messages, and the
	// {model, stream, request} wrapper for generate. Ignored for models.
	Body json.RawMessage
	// Header is the client's request headers; only the per-protocol
	// allowlist (provider.ForwardedRequestHeaders) is forwarded.
	Header http.Header
}

// ProxyStream is the vendor answer to copy to the client. Header holds only
// the allowlisted headers. Body must be closed: closing it settles the
// usage row.
type ProxyStream struct {
	Status int
	Header http.Header
	Body   io.ReadCloser
	Stream bool
}

// proxyHeaderAllowlist is every vendor response header the client sees;
// Content-Type is further narrowed by safeProxyContentType.
var proxyHeaderAllowlist = []string{"Retry-After"}

// safeProxyContentType passes a vendor Content-Type through only when it is
// JSON, SSE or plain text; anything else (an HTML error page from a custom
// base URL) is served as opaque bytes so the API origin never renders it.
func safeProxyContentType(v string) string {
	mt, _, err := mime.ParseMediaType(v)
	if err == nil {
		switch mt {
		case "application/json", "text/event-stream", "text/plain":
			return v
		}
	}
	return "application/octet-stream"
}

// geminiModelRE keeps the model id a plain path segment.
var geminiModelRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

const maxProxyErrorBody = 64 << 10

// SetBYOKClient swaps the proxy transport (tests).
func (g *Gateway) SetBYOKClient(c *provider.BYOKClient) { g.byok = c }

// ValidateBYOKBaseURL is the save-time check for a custom base URL, for the
// credential service (contract D4); the dial-time guard runs regardless.
func (g *Gateway) ValidateBYOKBaseURL(ctx context.Context, raw string) (string, error) {
	u, err := g.byok.ValidateBYOKBaseURL(ctx, raw)
	if err != nil {
		if errors.Is(err, provider.ErrBaseURLRefused) {
			return "", ErrBaseURLRefused.wrap(err)
		}
		return "", ErrProviderUnreachable.wrap(err)
	}
	return u, nil
}

// Proxy forwards one call. It does not need the server's own provider: a
// gateway disabled for UniWork-paid AI still proxies a person's own key.
func (g *Gateway) Proxy(ctx context.Context, req ProxyRequest) (*ProxyStream, error) {
	p, ok := provider.LookupBYOKProvider(req.Credential.Provider)
	if !ok || !ProxyOpFits(req.Op, p.Protocol) {
		return nil, ErrProviderNotSupported
	}
	if p.RequiresBaseURL && req.Credential.BaseURL == "" {
		return nil, ErrBaseURLRefused
	}
	out, model, err := vendorCall(p, req)
	if err != nil {
		return nil, err
	}
	out.Provider, out.BaseURL, out.APIKey = p, req.Credential.BaseURL, req.Credential.APIKey
	out.Header = req.Header

	var rowID string
	if req.Op != ProxyModels {
		row, err := g.q.AiInsertUsageEvent(ctx, db.AiInsertUsageEventParams{
			ID: util.NewID(), OrganizationID: req.OrganizationID, ActorID: req.Actor.ID, ActorKind: actorKind(req.Actor),
			Capability: string(CapOfficeBYOK), PromptID: "", Provider: p.ID, Model: model, Status: "pending",
			CorrelationID: audit.CorrelationID(ctx),
		})
		if err != nil {
			return nil, err
		}
		rowID = row.ID
	}
	started := g.now()
	settle := func(status, reason string, in, outTok int) {
		if rowID == "" {
			return
		}
		latency := g.now().Sub(started)
		// The request context may be gone (client hung up); the row still settles.
		_, ferr := g.q.AiFinishUsageEvent(context.WithoutCancel(ctx), db.AiFinishUsageEventParams{
			ID: rowID, Status: status, ReasonCode: optText(reason), InputTokens: int32(in), OutputTokens: int32(outTok),
			LatencyMs: pgtype.Int4{Int32: int32(latency.Milliseconds()), Valid: true}, ToolCalls: "[]",
		})
		if ferr != nil {
			g.log.Warn("ai: byok usage finish", "usage_event_id", rowID, "err", ferr)
		}
		g.observe(CapOfficeBYOK, status, latency)
	}

	res, err := g.byok.Do(ctx, out)
	if err != nil {
		if errors.Is(err, provider.ErrBaseURLRefused) {
			settle("failed", ErrBaseURLRefused.Code, 0, 0)
			return nil, ErrBaseURLRefused.wrap(err)
		}
		settle("failed", ErrProviderUnreachable.Code, 0, 0)
		g.log.Warn("ai: byok vendor unreachable", "usage_event_id", rowID, "provider", p.ID, "err", err)
		return nil, ErrProviderUnreachable.wrap(err)
	}
	header := http.Header{}
	for _, k := range proxyHeaderAllowlist {
		if v := res.Header.Get(k); v != "" {
			header.Set(k, v)
		}
	}
	header.Set("Content-Type", safeProxyContentType(res.Header.Get("Content-Type")))
	if res.Status == http.StatusUnauthorized || res.Status == http.StatusForbidden {
		_ = res.Body.Close()
		settle("failed", ErrProviderAuthFailed.Code, 0, 0)
		return nil, ErrProviderAuthFailed
	}
	if res.Status < 200 || res.Status > 299 {
		// Vendor errors pass through, but only after the key is scrubbed
		// from them (some vendors echo a malformed key back).
		data, rerr := io.ReadAll(io.LimitReader(res.Body, maxProxyErrorBody))
		_ = res.Body.Close()
		if rerr != nil {
			settle("failed", ErrProviderUnreachable.Code, 0, 0)
			return nil, ErrProviderUnreachable.wrap(rerr)
		}
		settle("failed", "provider_error", 0, 0)
		return &ProxyStream{Status: res.Status, Header: header, Body: io.NopCloser(bytes.NewReader(RedactKey(data, out.APIKey)))}, nil
	}
	tap := &usageTap{rc: res.Body, protocol: p.Protocol, stream: out.Stream}
	tap.onClose = func(eof bool) {
		if eof {
			settle("succeeded", "", tap.in, tap.out)
		} else {
			settle("failed", "stream_incomplete", tap.in, tap.out)
		}
	}
	return &ProxyStream{Status: res.Status, Header: header, Body: tap, Stream: out.Stream}, nil
}

// ProxyOpFits: each route belongs to one protocol; the model list to all.
func ProxyOpFits(op ProxyOp, p provider.BYOKProtocol) bool {
	switch op {
	case ProxyChatCompletions:
		return p == provider.ProtocolOpenAICompatible
	case ProxyMessages:
		return p == provider.ProtocolAnthropic
	case ProxyGenerate:
		return p == provider.ProtocolGemini
	case ProxyModels:
		return true
	default:
		return false
	}
}

// vendorCall maps an op onto the vendor path and body. The model name is
// only read (for the usage row and Gemini's URL), never rewritten.
func vendorCall(p provider.BYOKProvider, req ProxyRequest) (provider.BYOKRequest, string, error) {
	if req.Op == ProxyModels {
		path := "/models"
		if p.Protocol == provider.ProtocolAnthropic {
			path = "/v1/models"
		}
		return provider.BYOKRequest{Method: http.MethodGet, Path: path}, "", nil
	}
	var head struct {
		Model   string          `json:"model"`
		Stream  bool            `json:"stream"`
		Request json.RawMessage `json:"request"`
	}
	if err := json.Unmarshal(req.Body, &head); err != nil {
		return provider.BYOKRequest{}, "", ErrProxyBadRequest.wrap(err)
	}
	model := truncate(head.Model, 200)
	switch req.Op {
	case ProxyChatCompletions:
		return provider.BYOKRequest{Method: http.MethodPost, Path: "/chat/completions", Body: req.Body, Stream: head.Stream}, model, nil
	case ProxyMessages:
		return provider.BYOKRequest{Method: http.MethodPost, Path: "/v1/messages", Body: req.Body, Stream: head.Stream}, model, nil
	default: // ProxyGenerate
		if !geminiModelRE.MatchString(head.Model) || len(head.Request) == 0 || head.Request[0] != '{' {
			return provider.BYOKRequest{}, "", ErrProxyBadRequest
		}
		out := provider.BYOKRequest{Method: http.MethodPost, Body: head.Request, Stream: head.Stream}
		if head.Stream {
			out.Path = "/models/" + head.Model + ":streamGenerateContent"
			out.Query = url.Values{"alt": {"sse"}}
		} else {
			out.Path = "/models/" + head.Model + ":generateContent"
		}
		return out, model, nil
	}
}

// RedactKey replaces every occurrence of key in b (contract D8).
func RedactKey(b []byte, key string) []byte {
	if key == "" {
		return b
	}
	b = bytes.ReplaceAll(b, []byte(key), []byte("[redacted]"))
	// A vendor that JSON-escapes "/" echoes a key containing one as "\/".
	if esc := strings.ReplaceAll(key, "/", `\/`); esc != key {
		b = bytes.ReplaceAll(b, []byte(esc), []byte("[redacted]"))
	}
	return b
}

func actorKind(a audit.Actor) string {
	if a.Kind == "" {
		return "system"
	}
	return string(a.Kind)
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// ---- Usage: read from the bytes as they pass, never altering them ----

const (
	maxUsageLine = 1 << 20 // an SSE line longer than this is not a usage frame
	maxUsageBody = 8 << 20 // a non-streaming body past this is not parsed
)

// usageTap passes the vendor body through and keeps the last usage block it
// sees: per SSE line when streaming, the whole JSON otherwise.
type usageTap struct {
	rc       io.ReadCloser
	protocol provider.BYOKProtocol
	stream   bool
	line     []byte
	whole    bytes.Buffer
	skipLine bool
	in, out  int
	eof      bool
	onClose  func(eof bool)
	once     sync.Once
}

func (t *usageTap) Read(p []byte) (int, error) {
	n, err := t.rc.Read(p)
	if n > 0 {
		t.feed(p[:n])
	}
	if err == io.EOF {
		t.eof = true
	}
	return n, err
}

func (t *usageTap) feed(b []byte) {
	if !t.stream {
		if t.whole.Len()+len(b) <= maxUsageBody {
			t.whole.Write(b)
		}
		return
	}
	for len(b) > 0 {
		i := bytes.IndexByte(b, '\n')
		if i < 0 {
			t.appendLine(b)
			return
		}
		t.appendLine(b[:i])
		if !t.skipLine {
			t.parse(t.line)
		}
		t.line, t.skipLine = t.line[:0], false
		b = b[i+1:]
	}
}

func (t *usageTap) appendLine(b []byte) {
	if t.skipLine || len(t.line)+len(b) > maxUsageLine {
		t.skipLine = true
		return
	}
	t.line = append(t.line, b...)
}

func (t *usageTap) Close() error {
	err := t.rc.Close()
	t.once.Do(func() {
		if t.stream {
			if !t.skipLine {
				t.parse(t.line)
			}
		} else {
			t.parse(t.whole.Bytes())
		}
		if t.onClose != nil {
			t.onClose(t.eof)
		}
	})
	return err
}

type tokenCounts struct {
	PromptTokens     *int `json:"prompt_tokens"`
	CompletionTokens *int `json:"completion_tokens"`
	InputTokens      *int `json:"input_tokens"`
	OutputTokens     *int `json:"output_tokens"`
}

type usageProbe struct {
	Usage   *tokenCounts `json:"usage"`
	Message *struct {
		Usage *tokenCounts `json:"usage"`
	} `json:"message"`
	UsageMetadata *struct {
		PromptTokenCount     *int `json:"promptTokenCount"`
		CandidatesTokenCount *int `json:"candidatesTokenCount"`
		ThoughtsTokenCount   *int `json:"thoughtsTokenCount"`
	} `json:"usageMetadata"`
}

// parse reads one JSON document (an SSE data line or a whole body). Every
// protocol reports cumulative counts, so the latest value wins:
// openai-compatible: usage.{prompt,completion}_tokens (streamed only when
// the client asked for stream_options.include_usage); anthropic:
// message_start.message.usage.input_tokens then message_delta
// usage.output_tokens; gemini: usageMetadata on each chunk.
func (t *usageTap) parse(b []byte) {
	s := bytes.TrimSpace(b)
	if t.stream {
		rest, ok := bytes.CutPrefix(s, []byte("data:"))
		if !ok {
			return
		}
		s = bytes.TrimSpace(rest)
	}
	if len(s) == 0 || s[0] != '{' {
		return
	}
	var u usageProbe
	if json.Unmarshal(s, &u) != nil {
		return
	}
	switch t.protocol {
	case provider.ProtocolGemini:
		if m := u.UsageMetadata; m != nil {
			setIf(&t.in, m.PromptTokenCount)
			if m.CandidatesTokenCount != nil || m.ThoughtsTokenCount != nil {
				t.out = deref(m.CandidatesTokenCount) + deref(m.ThoughtsTokenCount)
			}
		}
	case provider.ProtocolAnthropic:
		if u.Message != nil && u.Message.Usage != nil {
			setIf(&t.in, u.Message.Usage.InputTokens)
			setIf(&t.out, u.Message.Usage.OutputTokens)
		}
		if u.Usage != nil {
			setIf(&t.in, u.Usage.InputTokens)
			setIf(&t.out, u.Usage.OutputTokens)
		}
	default:
		if u.Usage != nil {
			setIf(&t.in, u.Usage.PromptTokens)
			setIf(&t.out, u.Usage.CompletionTokens)
		}
	}
}

func setIf(dst *int, v *int) {
	if v != nil {
		*dst = *v
	}
}

func deref(v *int) int {
	if v == nil {
		return 0
	}
	return *v
}
