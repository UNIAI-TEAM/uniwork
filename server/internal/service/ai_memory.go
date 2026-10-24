package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// Ask UNI memory limits (P4 R3).
const (
	aiMemoryMaxEntries          = 50
	aiMemoryMaxRunes            = 300
	aiMemoryImportMaxRunes      = 20000
	aiMemoryImportMaxCandidates = 100
	aiMemoryImportPerHour       = 5
	askMaxMemoryRows            = 3
	aiMemoryProposalTTL         = 24 * time.Hour

	askMemoryFlag = "ask_uni_memory"
)

// Memory entry kinds and sources, as the table's CHECKs list them.
const (
	AiMemoryKindPreference = "preference"
	AiMemoryKindFact       = "fact"
	aiMemorySourceManual   = "manual"
)

var (
	errAiMemoryDisabled  = CodedError{Code: "ai_memory_disabled", Status: http.StatusForbidden}
	errAiMemoryFull      = CodedError{Code: "ai_memory_full", Status: http.StatusConflict}
	errAiMemoryDuplicate = CodedError{Code: "ai_memory_duplicate", Status: http.StatusConflict}
)

// AiMemoryService owns one person's short memory list per organization. ws and
// metrics serve the proposal and import commands that build on it.
type AiMemoryService struct {
	pool    *pgxpool.Pool
	q       *db.Queries
	orgs    *OrganizationService
	ws      *WorkspaceService
	flags   McpFlags
	metrics AskAgentMetrics
	now     func() time.Time
}

func NewAiMemoryService(pool *pgxpool.Pool, q *db.Queries, orgs *OrganizationService, ws *WorkspaceService) *AiMemoryService {
	return &AiMemoryService{pool: pool, q: q, orgs: orgs, ws: ws, now: time.Now}
}

func (s *AiMemoryService) SetFlags(f McpFlags)          { s.flags = f }
func (s *AiMemoryService) SetMetrics(m AskAgentMetrics) { s.metrics = m }

// AiMemoryList is the person's entries (preferences first) and the switch.
type AiMemoryList struct {
	Entries          []db.AiMemory
	On               bool
	Limit, Remaining int
}

func (s *AiMemoryService) flagOn(ctx context.Context, userID, orgID string) bool {
	if s.flags == nil {
		return false
	}
	f, _ := featureflags.Lookup(askMemoryFlag)
	fctx := featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: userID, OrganizationID: orgID})
	return s.flags.IsEnabled(fctx, askMemoryFlag, f.Default)
}

// AskMemoryEnabled is ask_uni_memory for the person in orgID; with no
// organization it is on when on in any of the person's active ones (R1).
func (s *AiMemoryService) AskMemoryEnabled(ctx context.Context, userID, orgID string) bool {
	if orgID != "" {
		return s.flagOn(ctx, userID, orgID)
	}
	orgs, err := activeOrganizations(ctx, s.q, userID)
	if err != nil {
		return false
	}
	if len(orgs) == 0 {
		return s.flagOn(ctx, userID, "")
	}
	for _, o := range orgs {
		if s.flagOn(ctx, userID, o.ID) {
			return true
		}
	}
	return false
}

// gate refuses a non-member (403/404 from RequireMember) and a flag that is off.
func (s *AiMemoryService) gate(ctx context.Context, userID, orgID string) error {
	if _, err := s.orgs.RequireMember(ctx, orgID, userID); err != nil {
		return err
	}
	if !s.flagOn(ctx, userID, orgID) {
		return errAiMemoryDisabled
	}
	return nil
}

func validMemoryKind(k string) error {
	if k != AiMemoryKindPreference && k != AiMemoryKindFact {
		return Invalid("kind must be preference or fact")
	}
	return nil
}

// validMemoryText returns the trimmed text, or a 400 when it is empty, over
// 300 runes, or holds a line break or control character.
func validMemoryText(s string) (string, error) {
	s = strings.TrimSpace(s)
	n := utf8.RuneCountInString(s)
	if n == 0 || n > aiMemoryMaxRunes {
		return "", Invalid("text must be 1 to 300 characters")
	}
	for _, r := range s {
		if unicode.IsControl(r) || unicode.Is(unicode.Zl, r) || unicode.Is(unicode.Zp, r) {
			return "", Invalid("text must be one line without control characters")
		}
	}
	return s, nil
}

// aiMemoryKey is the canonical form two entries are compared by.
func aiMemoryKey(s string) string {
	return foldForSearch(strings.Join(strings.Fields(s), " "))
}

func (s *AiMemoryService) List(ctx context.Context, userID, orgID string) (AiMemoryList, error) {
	if err := s.gate(ctx, userID, orgID); err != nil {
		return AiMemoryList{}, err
	}
	rows, err := s.q.AiListMemories(ctx, db.AiListMemoriesParams{OrganizationID: orgID, UserID: userID})
	if err != nil {
		return AiMemoryList{}, err
	}
	off, err := s.q.GetUserAskUniMemoryOff(ctx, userID)
	if err != nil {
		return AiMemoryList{}, err
	}
	return AiMemoryList{Entries: rows, On: !off, Limit: aiMemoryMaxEntries, Remaining: max(0, aiMemoryMaxEntries-len(rows))}, nil
}

func (s *AiMemoryService) inTx(ctx context.Context, fn func(q *db.Queries) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(s.q.WithTx(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *AiMemoryService) Create(ctx context.Context, userID, orgID, kind, text string) (db.AiMemory, error) {
	if err := s.gate(ctx, userID, orgID); err != nil {
		return db.AiMemory{}, err
	}
	var out db.AiMemory
	err := s.inTx(ctx, func(q *db.Queries) (err error) {
		out, err = s.createQ(ctx, q, orgID, userID, kind, text, aiMemorySourceManual, "")
		return err
	})
	return out, err
}

// createQ adds one entry inside the caller's transaction: it takes the owner
// lock (R5), checks the text, the duplicate and the cap, inserts, and audits.
func (s *AiMemoryService) createQ(ctx context.Context, q *db.Queries, orgID, userID, kind, body, source, proposalID string) (db.AiMemory, error) {
	if err := validMemoryKind(kind); err != nil {
		return db.AiMemory{}, err
	}
	body, err := validMemoryText(body)
	if err != nil {
		return db.AiMemory{}, err
	}
	if err := q.AiLockMemoryOwner(ctx, db.AiLockMemoryOwnerParams{OrganizationID: orgID, UserID: userID}); err != nil {
		return db.AiMemory{}, err
	}
	rows, err := q.AiListMemories(ctx, db.AiListMemoriesParams{OrganizationID: orgID, UserID: userID})
	if err != nil {
		return db.AiMemory{}, err
	}
	if len(rows) >= aiMemoryMaxEntries {
		return db.AiMemory{}, errAiMemoryFull
	}
	if aiMemoryTaken(rows, "", body) {
		return db.AiMemory{}, errAiMemoryDuplicate
	}
	row, err := q.AiInsertMemory(ctx, db.AiInsertMemoryParams{
		ID: util.NewID(), OrganizationID: orgID, UserID: userID, Kind: kind, Body: body, Source: source,
		ProposalID: pgtype.Text{String: proposalID, Valid: proposalID != ""},
		CreatedBy:  userID, CreatedByKind: string(audit.KindHuman),
	})
	if err != nil {
		return db.AiMemory{}, err
	}
	return row, auditRecorder.Record(ctx, q, memoryEntry(row, audit.ActionAIMemoryCreated, nil))
}

func aiMemoryTaken(rows []db.AiMemory, exceptID, body string) bool {
	key := aiMemoryKey(body)
	for _, r := range rows {
		if r.ID != exceptID && aiMemoryKey(r.Body) == key {
			return true
		}
	}
	return false
}

// memoryEntry is the audit row of one entry. It names the kind, source and
// length, never the text (R14).
func memoryEntry(m db.AiMemory, action string, changes map[string]audit.Change) audit.Entry {
	return audit.Entry{
		OrganizationID: m.OrganizationID, Actor: audit.User(m.UserID), Action: action,
		ResourceType: "ai_memory", ResourceID: m.ID, Changes: changes,
		Metadata: map[string]any{"kind": m.Kind, "source": m.Source, "chars": utf8.RuneCountInString(m.Body)},
	}
}

func (s *AiMemoryService) Update(ctx context.Context, userID, orgID, id string, kind, text *string) (db.AiMemory, error) {
	if err := s.gate(ctx, userID, orgID); err != nil {
		return db.AiMemory{}, err
	}
	var out db.AiMemory
	err := s.inTx(ctx, func(q *db.Queries) (err error) {
		out, err = s.updateQ(ctx, q, orgID, userID, id, kind, text)
		return err
	})
	return out, err
}

// updateQ changes kind and/or text of one of the person's entries. It takes
// the owner lock so a concurrent edit cannot make two entries equal.
func (s *AiMemoryService) updateQ(ctx context.Context, q *db.Queries, orgID, userID, id string, kind, text *string) (db.AiMemory, error) {
	if err := q.AiLockMemoryOwner(ctx, db.AiLockMemoryOwnerParams{OrganizationID: orgID, UserID: userID}); err != nil {
		return db.AiMemory{}, err
	}
	cur, err := q.AiGetMemory(ctx, db.AiGetMemoryParams{ID: id, OrganizationID: orgID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.AiMemory{}, ErrNotFound
	}
	if err != nil {
		return db.AiMemory{}, err
	}
	k, body := cur.Kind, cur.Body
	if kind != nil {
		if err := validMemoryKind(*kind); err != nil {
			return db.AiMemory{}, err
		}
		k = *kind
	}
	if text != nil {
		if body, err = validMemoryText(*text); err != nil {
			return db.AiMemory{}, err
		}
		rows, err := q.AiListMemories(ctx, db.AiListMemoriesParams{OrganizationID: orgID, UserID: userID})
		if err != nil {
			return db.AiMemory{}, err
		}
		if aiMemoryTaken(rows, id, body) {
			return db.AiMemory{}, errAiMemoryDuplicate
		}
	}
	row, err := q.AiUpdateMemory(ctx, db.AiUpdateMemoryParams{ID: id, OrganizationID: orgID, UserID: userID, Kind: k, Body: body})
	if err != nil {
		return db.AiMemory{}, err
	}
	changes := map[string]audit.Change{}
	if k != cur.Kind {
		changes["kind"] = audit.Change{From: cur.Kind, To: k}
	}
	if from, to := utf8.RuneCountInString(cur.Body), utf8.RuneCountInString(body); from != to {
		changes["chars"] = audit.Change{From: from, To: to}
	}
	return row, auditRecorder.Record(ctx, q, memoryEntry(row, audit.ActionAIMemoryUpdated, changes))
}

func (s *AiMemoryService) Delete(ctx context.Context, userID, orgID, id string) error {
	if err := s.gate(ctx, userID, orgID); err != nil {
		return err
	}
	return s.inTx(ctx, func(q *db.Queries) error { return s.deleteQ(ctx, q, orgID, userID, id) })
}

func (s *AiMemoryService) deleteQ(ctx context.Context, q *db.Queries, orgID, userID, id string) error {
	cur, err := q.AiGetMemory(ctx, db.AiGetMemoryParams{ID: id, OrganizationID: orgID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	n, err := q.AiDeleteMemory(ctx, db.AiDeleteMemoryParams{ID: id, OrganizationID: orgID, UserID: userID})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return auditRecorder.Record(ctx, q, memoryEntry(cur, audit.ActionAIMemoryDeleted, nil))
}

// Clear deletes every entry of the person in orgID and returns how many.
func (s *AiMemoryService) Clear(ctx context.Context, userID, orgID string) (int64, error) {
	if err := s.gate(ctx, userID, orgID); err != nil {
		return 0, err
	}
	var n int64
	err := s.inTx(ctx, func(q *db.Queries) (err error) {
		if n, err = q.AiClearMemories(ctx, db.AiClearMemoriesParams{OrganizationID: orgID, UserID: userID}); err != nil || n == 0 {
			return err
		}
		return auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: orgID, Actor: audit.User(userID), Action: audit.ActionAIMemoryCleared,
			ResourceType: "ai_memory", ResourceID: userID, Metadata: map[string]any{"count": n},
		})
	})
	return n, err
}

// SetOn is the person's own switch; it spans organizations and writes no audit.
func (s *AiMemoryService) SetOn(ctx context.Context, userID string, on bool) error {
	if !s.AskMemoryEnabled(ctx, userID, "") {
		return errAiMemoryDisabled
	}
	return s.q.SetUserAskUniMemoryOff(ctx, db.SetUserAskUniMemoryOffParams{ID: userID, Off: !on})
}
