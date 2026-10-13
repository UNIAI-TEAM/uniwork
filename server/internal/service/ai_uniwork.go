package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// AIUniworkService is the service half of the UniWork AI façade (G6-03a):
// the gates in contract order — RequireMember -> Can(office.ai_cloud) ->
// kill switch + per-format flag -> CheckQuota -> concurrency -> Gateway
// (which records the usage row) — plus the conversation binding of OQ-P2 and
// the server-held transcript. The wire shapes and the Gateway translation
// live in internal/ai/openai_facade.go; the handlers only name the actor and
// the scope. Scaffolded methods return errAIUniworkTODO until S1 (design:
// reports/g6-ai_server/g6-03a-design.md §7-§9).

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

var errAIUniworkTODO = errors.New("service: ai_uniwork scaffold, not implemented until G6-03a S1")

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
}

// NewAIUniworkService wires the service. rdb may be nil: the per-organization
// and whole-deployment bounds then live in-process only (A11).
func NewAIUniworkService(orgs *OrganizationService, ents *EntitlementService, docs *DocumentService,
	flags *featureflag.Service, gw *ai.Gateway, store ai.ConversationStore, rdb *redis.Client) *AIUniworkService {
	return &AIUniworkService{
		orgs: orgs, ents: ents, docs: docs, flags: flags, gw: gw, store: store,
		limiter:  newUniworkConcurrency(rdb, UniworkPodMax, UniworkOrgMax, UniworkGlobalMax, UniworkDeadline+10*time.Second),
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

// UniworkScope is who and what one turn acts on. DocumentID/Module are empty
// on the org route (R1: a local file, S10); Edit reports whether the caller
// may edit the bound document (rule 6), false when there is none.
type UniworkScope struct {
	UserID     string
	OrgID      string
	DocumentID string
	Module     string
	DeviceID   string
	Edit       bool
}

// UniworkTurnInput is one client call: the raw openai-compatible body the
// handler read (bounded by maxJSONBody) and the conversation it continues.
type UniworkTurnInput struct {
	ConversationID string
	Body           json.RawMessage
	Stream         bool
}

// UniworkTurn is one answered turn: what the handler writes out plus the
// conversation id it must echo as a header (A12).
type UniworkTurn struct {
	Response       ai.Response
	ConversationID string
	Step           int
	Limit          int
	Dropped        []ai.UniworkDroppedToolCall
	Stream         bool
}

// Chat answers one turn: gates, conversation, transcript, one Gateway call.
func (s *AIUniworkService) Chat(ctx context.Context, scope UniworkScope, in UniworkTurnInput) (UniworkTurn, error) {
	return UniworkTurn{}, errAIUniworkTODO
}

// SweepConversations is the TTL worker's entry (W-B wires it into the
// shutdown chain): expired conversations, then the organizations whose kill
// switch is off (A9).
func (s *AIUniworkService) SweepConversations(ctx context.Context) (int64, error) {
	return 0, errAIUniworkTODO
}

// uniworkConcurrency bounds the UniWork AI turns running at once (A11): a
// pod semaphore, a per-organization bound, and a whole-deployment bound in
// Redis when one is configured. Without Redis the shared bounds are dropped
// (fail open, like every Redis-backed limiter) and only the pod bound holds.
// Exceeding a bound is 429 ai_uniwork_busy with Retry-After: 5.
type uniworkConcurrency struct {
	rdb       *redis.Client
	pod       chan struct{}
	orgMax    int
	globalMax int
	leaseTTL  time.Duration
}

func newUniworkConcurrency(rdb *redis.Client, podMax, orgMax, globalMax int, leaseTTL time.Duration) *uniworkConcurrency {
	return &uniworkConcurrency{
		rdb: rdb, pod: make(chan struct{}, podMax), orgMax: orgMax, globalMax: globalMax, leaseTTL: leaseTTL,
	}
}

// Acquire takes one slot and returns the release to defer. It never blocks:
// a bound at its cap answers immediately.
func (c *uniworkConcurrency) Acquire(ctx context.Context, orgID string) (release func(), err error) {
	return func() {}, errAIUniworkTODO
}
