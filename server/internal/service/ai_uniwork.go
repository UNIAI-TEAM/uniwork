package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// AIUniworkService is the service half of the UniWork AI façade (G6-03a):
// the gates in contract order — RequireMember -> Can(office.ai_cloud) ->
// kill switch + per-format flag -> CheckQuota -> concurrency -> Gateway
// (which records the usage row) — plus the conversation binding of OQ-P2 and
// the server-held transcript. The wire shapes and the Gateway translation
// live in internal/ai/openai_facade.go; the handlers only name the actor and
// the scope.

// Deadline and concurrency numbers. The deadline is A14's 55 s from the
// moment the request arrives (under the fork's 60 s watchdog); the
// concurrency defaults are A11, with G7-D1 owning their final values.
const (
	UniworkDeadline       = 55 * time.Second
	UniworkPodMax         = 32
	UniworkGlobalMax      = 64
	UniworkOrgMax         = 8
	UniworkBusyRetryAfter = 5
)

// AIUniworkService holds the process-wide pieces one turn needs. flags
// evaluates office_ai_uniwork / office_ai_uniwork_<format> through the same
// service GET /api/v1/config uses; store is nil when the deployment has no
// transcript store (fail closed, ai_disabled).
type AIUniworkService struct {
	orgs     *OrganizationService
	ents     *EntitlementService
	docs     *DocumentService
	flags    *featureflag.Service
	gw       *ai.Gateway
	store    ai.ConversationStore
	limiter  *uniworkConcurrency
	now      func() time.Time
	deadline time.Duration
	// runs is A3's run counter (G6-03b). Wired by SetRunStore; nil leaves the
	// service without run accounting until W-B fills the seam (design §9).
	runs ai.RunStore
	// metrics is the run/usage surface of §7; nil reports nothing.
	metrics UniworkRunMetrics
}

// UniworkRunMetrics is the UniWork AI run/usage surface the service reports to
// (metrics.AIUniwork satisfies it; design §7).
type UniworkRunMetrics interface {
	ObserveUniworkRun(seconds float64, credits int64)
	IncUniworkUsageUnknown(calls int64)
	IncUniworkDroppedToolCalls(reason string, calls int64)
}

// SetRunStore attaches A3's run counter (G6-03b).
func (s *AIUniworkService) SetRunStore(store ai.RunStore) { s.runs = store }

// SetUniworkMetrics attaches the run/usage metrics (G6-03b).
func (s *AIUniworkService) SetUniworkMetrics(m UniworkRunMetrics) { s.metrics = m }

// takeRun reserves the model call this turn is about to spend (A3). The store
// holds the caps across pods with one conditional update (design §4.2), so
// this is the only place a turn waits on the run counters; the limiter has
// already been taken, so a turn refused here holds no concurrency slot. The
// store answers ErrRunExpired for a run id unknown, expired or another
// conversation's, and RunLimitReached when a cap is already spent — both are
// *ai.Error and travel to the wire as they are (409, design §2.3).
//
// A deployment whose run store is not wired keeps 03a behaviour: no run
// accounting, no run id on the answer (the scaffold seam of design §11).
func (s *AIUniworkService) takeRun(ctx context.Context, in ai.TakeRunTurn) (ai.Run, error) {
	if s.runs == nil {
		return ai.Run{}, nil
	}
	return s.runs.TakeTurn(ctx, in)
}

// addRunCredits records what an answered call cost the run and reports the
// two run histograms of §7. Both the store write and the observations run on
// a context detached from the request (§6.2): a client that hung up after the
// vendor answered still leaves the run's credits and the metrics behind. A
// credits failure is logged, never turned into a refused answer — the answer
// and the transcript matter more than a counter.
func (s *AIUniworkService) addRunCredits(ctx context.Context, run ai.Run, tokens int64) {
	if run.ID == "" {
		return
	}
	sctx, cancel := uniworkSettleContext(ctx)
	defer cancel()
	if tokens > 0 {
		if err := s.runs.AddCredits(sctx, run.ID, run.ConversationID, tokens); err != nil {
			slog.Default().Warn("uniwork ai: run credits", "run_id", run.ID, "err", err)
		}
	}
	if s.metrics != nil {
		// The run's credits after this turn: what the store held before it
		// (zero for a run opened by this turn) plus what the vendor charged.
		s.metrics.ObserveUniworkRun(s.now().Sub(run.CreatedAt).Seconds(), run.Credits+tokens)
	}
}

// uniworkQuotaErr is §6.1: a spent ai.tokens meter answers 402
// credits_exhausted — the same code and shape as the organization-tier cloud
// route (errCreditsExhausted), so the client routes both to its credits
// state. A plan without the capability or an inactive subscription keeps its
// own code: those are refusals about the plan, not about credits.
func uniworkQuotaErr(err error) error {
	if errors.Is(err, ErrQuotaExceeded) {
		return errCreditsExhausted
	}
	return err
}

// uniworkSettleTimeout bounds the detached settle of a turn's credits, the
// same shape as the Gateway's own settleContext (ai/cloud.go).
const uniworkSettleTimeout = 10 * time.Second

// uniworkSettleContext is the context a turn's bookkeeping runs on: it keeps
// the request's values (correlation id) but not its cancellation, so a client
// hang-up cannot lose a run's credits.
func uniworkSettleContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), uniworkSettleTimeout)
}

// uniworkMeterKey is the idempotency key of one model call: (run id, seq),
// where seq is the model call this turn just reserved (design §6.4). Empty
// when there is no run, which keeps the Gateway's per-event key.
func uniworkMeterKey(run ai.Run) string {
	if run.ID == "" {
		return ""
	}
	return fmt.Sprintf("uniwork-ai:%s:%d", run.ID, run.ModelCalls)
}

// observeTurnMetrics records the §7 surface of one answered turn: the tool
// calls the allowlist dropped, by reason, and a vendor that sent no usage
// block.
func (s *AIUniworkService) observeTurnMetrics(resp ai.Response, dropped []ai.UniworkDroppedToolCall) {
	if s.metrics == nil {
		return
	}
	if !resp.UsagePresent {
		s.metrics.IncUniworkUsageUnknown(1)
	}
	if len(dropped) == 0 {
		return
	}
	counts := make(map[string]int64, 2)
	for _, d := range dropped {
		counts[d.Reason]++
	}
	for reason, calls := range counts {
		s.metrics.IncUniworkDroppedToolCalls(reason, calls)
	}
}

// NewAIUniworkService wires the service. rdb may be nil: the organization
// bound then lives in this process only — orgMax per pod, not shared — and
// the whole-deployment bound is the one that is dropped (A11).
func NewAIUniworkService(orgs *OrganizationService, ents *EntitlementService, docs *DocumentService,
	flags *featureflag.Service, gw *ai.Gateway, store ai.ConversationStore, rdb *redis.Client) *AIUniworkService {
	return &AIUniworkService{
		orgs: orgs, ents: ents, docs: docs, flags: flags, gw: gw, store: store,
		limiter:  newUniworkConcurrency(rdb, "ai:uniwork:", UniworkPodMax, UniworkOrgMax, UniworkGlobalMax, UniworkDeadline+10*time.Second),
		now:      time.Now,
		deadline: UniworkDeadline,
	}
}

// SetDeadline replaces the per-request deadline (tests shortens it).
func (s *AIUniworkService) SetDeadline(d time.Duration) {
	if d > 0 {
		s.deadline = d
	}
}

// Deadline is the 55 s budget the handler puts on the request context (A14).
func (s *AIUniworkService) Deadline() time.Duration { return s.deadline }

// UniworkScope is who and what one turn acts on. DocumentID/Module are empty
// on the org route (R1: a local file, S10).
type UniworkScope struct {
	UserID     string
	OrgID      string
	DocumentID string
	Module     string
	DeviceID   string
}

// UniworkTurnInput is one client call: the raw openai-compatible body the
// handler read (bounded by maxJSONBody), the conversation it continues and,
// from G6-03b, the run it continues (A12; empty opens a new run).
type UniworkTurnInput struct {
	ConversationID string
	RunID          string
	Body           json.RawMessage
	Stream         bool
}

// UniworkTurn is one answered turn: what the handler writes out plus the
// conversation id it must echo as a header (A12) and, from G6-03b, the run id
// every answer of the run carries and the step/limit of x_uniwork.
type UniworkTurn struct {
	Response       ai.Response
	ConversationID string
	RunID          string
	Step           int
	Limit          int
	Dropped        []ai.UniworkDroppedToolCall
	Stream         bool
}

// Chat answers one turn: gates, conversation, transcript, one Gateway call.
//
// The scope names the tenant differently per route (design §2): R1 and R2
// carry the organization (session bearer / frame token) and R2 adds the
// token's module, while R3 names only the document, so its organization,
// workspace and module come from that document. A turn whose document is no
// longer readable is refused and the caller's transcript for it is deleted
// (design §9.4: a share revoked with no event must not outlive the access).
func (s *AIUniworkService) Chat(ctx context.Context, scope UniworkScope, in UniworkTurnInput) (UniworkTurn, error) {
	doc, err := s.documentScope(ctx, scope)
	if err != nil {
		return UniworkTurn{}, err
	}
	orgID := scope.OrgID
	if orgID == "" {
		orgID = doc.orgID
	}
	if _, err := s.orgs.RequireMember(ctx, orgID, scope.UserID); err != nil {
		return UniworkTurn{}, err
	}
	if !s.gw.Enabled() {
		return UniworkTurn{}, ai.ErrDisabled
	}
	if err := s.ents.Can(ctx, orgID, FeatureOfficeAICloud); err != nil {
		return UniworkTurn{}, err
	}
	// The body is parsed before the flags because R1 names its module there
	// (D-3); the parse is rule 1's refusal (system/developer) and the turn
	// shape, both of which the plan needs anyway.
	req, err := ai.DecodeUniworkChatRequest(in.Body)
	if err != nil {
		return UniworkTurn{}, err
	}
	// The turn's module: R2's frame token and R3's document already answered
	// it; R1 takes the body's when the client names one (a local file, S10)
	// and refuses a name the pack carries no section for — the client-shape
	// 400 invalid_request, before any gate, conversation or usage row
	// (BE3A-15, design §3.4): the Gateway assembles its system text by module
	// and has nothing to fall back to, so letting the name through would
	// answer a client fault with a 500. R1 without one keeps the module its
	// scope carries — the frame resolver reads a token with no module claim
	// as docs (OfficeFrameClaims.ModuleName) — because a served turn must
	// have a module.
	module := doc.module
	if scope.DocumentID == "" && req.Module != "" {
		if _, ok := ai.UniworkPackModule(req.Module); !ok {
			return UniworkTurn{}, Invalid(fmt.Sprintf("module %q không được hỗ trợ", req.Module))
		}
		module = req.Module
	}
	if err := s.checkUniworkCapability(ctx, orgID, scope.UserID, module); err != nil {
		return UniworkTurn{}, err
	}
	if err := s.ents.CheckQuota(ctx, orgID, FeatureAITokens, 1); err != nil {
		return UniworkTurn{}, uniworkQuotaErr(err)
	}
	key := ai.ConversationKey{
		OrganizationID: orgID, UserID: scope.UserID, DocumentID: scope.DocumentID,
		Module: module, DeviceID: scope.DeviceID,
	}
	conv, err := s.resumeConversation(ctx, key, in.ConversationID)
	if err != nil {
		return UniworkTurn{}, err
	}
	allow := ai.UniworkModuleAllowlist(module, req.Tools, !doc.edit, scope.DocumentID != "")
	turn, err := ai.PlanUniworkTurn(transcriptMessages(conv), in.Body, allow)
	if err != nil {
		// The conversation exists and is untouched; the client still gets its
		// id back (A12) so the next turn can continue it.
		return UniworkTurn{ConversationID: conv.ID}, err
	}
	// A tool-result turn must name the run it answers (D-2, design §2.2):
	// without the header it would look like a question and open a new run,
	// which is the 8-round cap's escape hatch (one new run per round). The
	// rule holds while run accounting is wired; a deployment without the run
	// store has no cap to protect and keeps 03a behaviour.
	if s.runs != nil && turn.ToolResultTurn && in.RunID == "" {
		return UniworkTurn{ConversationID: conv.ID}, Invalid("lượt tool-result phải nêu header " + ai.UniworkRunHeader)
	}
	// The concurrency slot is taken last of the gates and released as soon as
	// the turn settles, so a run that fails early costs no slot and one that
	// answers holds it for exactly one upstream call (A11, design §7.2).
	release, err := s.limiter.Acquire(ctx, orgID)
	if err != nil {
		return UniworkTurn{ConversationID: conv.ID}, err
	}
	defer release()
	// The run counters are the last gate before the model (A3, design §5.5):
	// the limiter already ran, so a turn refused here holds no slot, and the
	// take is what makes the caps hold across pods. A refusal ends the run on
	// the client's side — it drops the run header and asks again, which opens
	// a new run in the same conversation (§4.3) — and the answer names the
	// run when there still is one (below).
	run, err := s.takeRun(ctx, ai.TakeRunTurn{
		OrganizationID: orgID, ConversationID: conv.ID, RunID: in.RunID,
		ToolRound: turn.ToolResultTurn, CreatedBy: scope.UserID, Now: s.now(),
	})
	if err != nil {
		// A spent cap is refused by a live run, and that refusal is an answer
		// of that run: the store hands it back with the error and it travels
		// to the answer (A12, design §2.1), so a client can tell "this run is
		// over" from "there was no run". A run that is gone (run_expired, the
		// lost race included) names nothing — the client drops the id it holds
		// and asks again, which opens a new run in the same conversation.
		return UniworkTurn{ConversationID: conv.ID, RunID: run.ID}, err
	}

	request := ai.Request{
		Actor: Human(scope.UserID), OrganizationID: orgID, WorkspaceID: doc.workspaceID,
		Capability: ai.CapOfficeUniworkAI, PromptID: ai.PromptOfficeUniworkAI, Module: allow.Module,
		History: turn.History, ToolResultTurn: turn.ToolResultTurn, Tools: allow.Tools,
		// The façade owns the tool contract: calls outside the allowlist come
		// back whole so they are reported through x_uniwork instead of failing
		// the turn (design §6.4, A13).
		FilterToolCalls: true,
		// One charge per (run, model call), so a replay of the same attempt
		// cannot be metered twice (design §6.4).
		MeterKey: uniworkMeterKey(run),
	}
	resp, err := s.gw.Complete(ctx, request)
	if err != nil {
		// Nothing of this attempt is in the transcript yet — Append runs only
		// after Complete succeeds — so there is nothing to roll back. A
		// Rollback here would delete by seq count alone and take a concurrent
		// attempt's turns with it. The run id travels back with the refusal
		// (429 upstream, 504, 502): the run is still live and the client
		// retries the same id (design §5.5).
		return UniworkTurn{ConversationID: conv.ID, RunID: run.ID}, err
	}
	kept, dropped := ai.FilterUniworkToolCalls(resp.ToolCalls, allow)
	resp.ToolCalls = kept
	// The run's credits and the §7 counters settle before the transcript
	// write, on a context that outlives the request (§6.2).
	s.addRunCredits(ctx, run, int64(resp.InputTokens+resp.OutputTokens))
	s.observeTurnMetrics(resp, dropped)
	// The transcript stores exactly what was sent plus the answer as the
	// client receives it: the new question as the plan put it on the wire, and
	// no dropped call — so the client's tool results answer every call the
	// history replays (rule 7, A13, design §6.2).
	appended := append(attemptMessages(turn), assistantMessage(resp))
	if err := s.store.Append(ctx, conv.ID, appended); err != nil {
		return UniworkTurn{ConversationID: conv.ID, RunID: run.ID}, err
	}
	return UniworkTurn{
		Response: resp, ConversationID: conv.ID, RunID: run.ID,
		Step: run.ToolRounds, Limit: ai.UniworkToolStepLimit, Dropped: dropped, Stream: turn.Stream,
	}, nil
}

// uniworkDocument is what the bound document (R2/R3) contributes to a turn.
type uniworkDocument struct {
	orgID       string
	workspaceID string
	module      string
	edit        bool
}

// documentScope authorizes the document a turn is bound to and answers its
// tenant, workspace, module and edit level. It runs before the organization
// gates because R3 names only the document (A10). R2's token already named
// the module (never re-derived, rule 3/7); R3's comes from the document's
// current file, exactly as the frame open route derives it.
func (s *AIUniworkService) documentScope(ctx context.Context, scope UniworkScope) (uniworkDocument, error) {
	out := uniworkDocument{orgID: scope.OrgID, module: scope.Module}
	if scope.DocumentID == "" {
		return out, nil
	}
	doc, access, err := s.docs.authorizeDocument(ctx, Human(scope.UserID), scope.DocumentID, DocumentLevelView)
	if err != nil {
		// Losing access with no event (a share or ACL change) ends the user's
		// transcript for this document on the next request, before the refusal
		// travels back (design §9.4). R3 names no organization, so the tenant
		// is read from the document row — only to name the rows to delete, and
		// nothing about it reaches the answer.
		if isGateRefusal(err) && s.store != nil {
			org := scope.OrgID
			if org == "" {
				org = s.uniworkDocumentOrg(ctx, scope.DocumentID)
			}
			if org != "" {
				_ = s.store.DeleteByUserDocument(ctx, org, scope.UserID, scope.DocumentID)
			}
		}
		return uniworkDocument{}, err
	}
	out.orgID, out.workspaceID = doc.OrganizationID, doc.WorkspaceID
	out.edit = access.Level.AtLeast(DocumentLevelEdit)
	if scope.Module == "" {
		file, err := s.docs.currentFileInfo(ctx, doc)
		if err != nil {
			return uniworkDocument{}, err
		}
		if file == nil {
			return uniworkDocument{}, ErrNotFound
		}
		module, ok := officeFrameModuleOf(file.MimeType, file.Filename)
		if !ok {
			return uniworkDocument{}, ErrNotFound
		}
		out.module = module
	}
	return out, nil
}

// uniworkDocumentOrg names the organization of a document the caller may no
// longer read, for the cleanup above only: the id it answers with never
// reaches the client, so it is not an existence oracle. A read that fails
// leaves the transcript to the TTL sweep.
func (s *AIUniworkService) uniworkDocumentOrg(ctx context.Context, documentID string) string {
	doc, err := s.docs.q.GetDocumentByID(ctx, documentID)
	if err != nil {
		return ""
	}
	return doc.OrganizationID
}

// resumeConversation continues the conversation the client named, or starts
// the conversation for the key when the client named none: the header the
// server issued is the whole continuation token (A12), and a client that
// starts over omits it. A named id that is gone, expired or bound to another
// scope is 409 conversation_expired — the client starts a new one instead of
// silently reading someone else's history.
func (s *AIUniworkService) resumeConversation(ctx context.Context, key ai.ConversationKey, conversationID string) (ai.Conversation, error) {
	if s.store == nil {
		return ai.Conversation{}, ai.ErrDisabled
	}
	if conversationID == "" {
		conv, err := s.store.Create(ctx, key)
		return conv, uniworkStoreErr(err)
	}
	conv, err := s.store.Resume(ctx, key, conversationID)
	return conv, uniworkStoreErr(err)
}

// uniworkStoreErr reads a deployment without a transcript store as "UniWork AI
// is not configured": fail closed, never a plaintext conversation (design §9.3).
func uniworkStoreErr(err error) error {
	if errors.Is(err, ai.ErrConversationStoreDisabled) {
		return ai.ErrDisabled
	}
	return err
}

// transcriptMessages is the stored transcript in the shape the façade plans
// against: exactly the provider messages the model was sent or produced.
func transcriptMessages(conv ai.Conversation) []provider.Message {
	msgs := make([]provider.Message, 0, len(conv.Turns))
	for _, t := range conv.Turns {
		msgs = append(msgs, t.Message)
	}
	return msgs
}

// attemptMessages is what this attempt adds to the transcript: the new
// question as the plan put it on the wire — the office pack renders nothing,
// so the message the model saw is the question itself (design §6.2) — or the
// tool results answering the server's last call.
func attemptMessages(turn ai.UniworkTurn) []ai.Turn {
	msgs := turn.ToolResults
	if !turn.ToolResultTurn {
		msgs = []provider.Message{{Role: "user", Content: turn.Question}}
	}
	turns := make([]ai.Turn, 0, len(msgs))
	for _, m := range msgs {
		turns = append(turns, ai.Turn{Message: m})
	}
	return turns
}

// assistantMessage is the model's answer as it enters the transcript: the
// content plus the calls the client was handed (a dropped call stays out of
// the conversation too).
func assistantMessage(resp ai.Response) ai.Turn {
	return ai.Turn{UsageEventID: resp.UsageEventID, Message: provider.Message{
		Role: "assistant", Content: resp.Text, ToolCalls: resp.ToolCalls,
	}}
}

// checkUniworkCapability is Q1: office_ai_uniwork hides the whole capability,
// office_ai_uniwork_<format> hides one format, and both answer the same 403
// office_capability_off with fields.capability so the client hides exactly
// what is off. When the server cannot name the turn's format it checks the
// kill switch alone (D-3, design §8.2).
func (s *AIUniworkService) checkUniworkCapability(ctx context.Context, orgID, userID, module string) error {
	ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: userID, OrganizationID: orgID})
	if !s.flagEnabled(ctx, officeAIUniworkFlag) {
		return errUniworkCapabilityOff("ai_uniwork")
	}
	token := uniworkFormatToken(module)
	if token == "" {
		return nil
	}
	if !s.flagEnabled(ctx, officeAIUniworkFormatPrefix+token) {
		return errUniworkCapabilityOff("ai_uniwork_" + token)
	}
	return nil
}

// flagEnabled evaluates one catalogue key for ctx, taking the declared default
// from the registry the way OfficeCapabilitiesService does, so the route and
// GET /orgs/{orgID}/office/capabilities never disagree.
func (s *AIUniworkService) flagEnabled(ctx context.Context, key string) bool {
	def := false
	if f, ok := featureflags.Lookup(key); ok {
		def = f.Default
	}
	return s.flags.IsEnabled(ctx, key, def)
}

// uniworkModuleFormats maps a genoffice module to the format token of its flag
// and of fields.capability (design §8.2). The tokens are the ones the app
// capability route publishes; TestAIUniworkFormatTokens keeps the two tables
// and officeFrameModules in step.
var uniworkModuleFormats = map[string]string{
	OfficeFrameModuleDocs:     "docx",
	OfficeFrameModuleSheets:   "xlsx",
	OfficeFrameModuleSlides:   "pptx",
	OfficeFrameModulePDF:      "pdf",
	OfficeFrameModuleMarkdown: "markdown",
	OfficeFrameModuleHTML:     "html",
}

// uniworkFormatToken names the format of a turn, "" when the module is unknown
// (then only the kill switch applies).
func uniworkFormatToken(module string) string { return uniworkModuleFormats[module] }

// errUniworkCapabilityOff is the kill switch / per-format refusal (Q1). It is
// deliberately unclassified: a flag hides the capability, it is not a
// permission denial, so the client must not run its lost-access path.
func errUniworkCapabilityOff(capability string) error {
	return CodedError{
		Code: "office_capability_off", Status: http.StatusForbidden,
		Msg:    "UniWork AI đang tắt cho tổ chức này",
		Fields: map[string]any{"capability": capability},
	}
}
