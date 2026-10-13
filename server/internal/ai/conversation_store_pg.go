package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The Postgres half of the conversation store (W-B, design §9): the interface,
// the types and the TTLs are in conversation_store.go, the SQL in
// server/pkg/db/queries/ai_uniwork.sql, the tables in
// 9991791859450570_ai_uniwork_conversations.
//
// A conversation is one row plus one row per turn, each turn sealed with
// secretbox (AES-256-GCM) under AI_CONVERSATION_KEY. The key is handed in as a
// Box and never read here; a nil Box means the deployment has no transcript
// store, so the paths that would read or write content answer
// ErrConversationStoreDisabled (fail closed, never plaintext) while the
// cleanup paths keep working. There is no foreign key (ADR 0001): a delete
// removes the turns and the conversation in one transaction, so no orphan
// ciphertext survives a document, a membership or an expiry.

// The TTL worker's batch and cadence. Expired rows go in batches so one pass
// holds no long transaction, and a minute is far below the idle TTL - an
// expired transcript is unreachable (409) the moment it expires, whatever the
// sweep is doing.
const (
	uniworkConversationSweepBatch      = int32(200)
	uniworkConversationSweepMaxBatches = 25
	uniworkConversationSweepPause      = 100 * time.Millisecond
	// UniworkConversationSweepInterval is how often main.go's worker sweeps.
	UniworkConversationSweepInterval = time.Minute
)

// The reasons that land in uniwork_ai_uniwork_conversations_swept_total.
const (
	UniworkSweepReasonExpired    = "expired"
	UniworkSweepReasonKillSwitch = "kill_switch"
)

// errTurnUnreadable marks a stored turn this deployment cannot open: a rotated
// AI_CONVERSATION_KEY or a corrupt row. The transcript is gone to its owner
// (conversation_expired), not the database broken (design §9.3).
var errTurnUnreadable = errors.New("ai: ai_uniwork_turns row không giải mã được")

// ConversationStorePG is the Postgres ConversationStore.
type ConversationStorePG struct {
	pool    *pgxpool.Pool
	queries *db.Queries
	box     *secretbox.Box
	now     func() time.Time
}

// NewConversationStore builds the store over an open pool. box may be nil: the
// deployment has no AI_CONVERSATION_KEY, and every path that would read or
// write a transcript answers ErrConversationStoreDisabled.
func NewConversationStore(pool *pgxpool.Pool, queries *db.Queries, box *secretbox.Box) *ConversationStorePG {
	return &ConversationStorePG{pool: pool, queries: queries, box: box, now: time.Now}
}

// SetClock replaces the store's clock (tests).
func (s *ConversationStorePG) SetClock(now func() time.Time) { s.now = now }

// Resume implements ConversationStore.
func (s *ConversationStorePG) Resume(ctx context.Context, key ConversationKey, conversationID string) (Conversation, error) {
	if s.disabled() != nil {
		return Conversation{}, ErrConversationStoreDisabled
	}
	now := s.now()
	var (
		row db.AiUniworkConversation
		err error
	)
	if conversationID == "" {
		row, err = s.queries.AiUniworkLatestConversation(ctx, db.AiUniworkLatestConversationParams{
			OrganizationID: key.OrganizationID,
			UserID:         key.UserID,
			Module:         key.Module,
			DocumentID:     nullableText(key.DocumentID),
			DeviceID:       nullableText(key.DeviceID),
			Now:            timestamptz(now),
		})
	} else {
		row, err = s.queries.AiUniworkGetConversation(ctx, db.AiUniworkGetConversationParams{
			ID: conversationID, OrganizationID: key.OrganizationID,
		})
		if err == nil && !keyMatchesConversation(key, row) {
			err = pgx.ErrNoRows
		}
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return Conversation{}, ErrConversationExpired
	}
	if err != nil {
		return Conversation{}, err
	}
	if !row.ExpiresAt.Time.After(now) {
		return Conversation{}, ErrConversationExpired
	}
	turns, err := s.loadTurns(ctx, row.ID)
	if errors.Is(err, errTurnUnreadable) {
		return Conversation{}, ErrConversationExpired
	}
	if err != nil {
		return Conversation{}, err
	}
	return conversationFromRow(row, turns), nil
}

// Create implements ConversationStore.
func (s *ConversationStorePG) Create(ctx context.Context, key ConversationKey) (Conversation, error) {
	if s.disabled() != nil {
		return Conversation{}, ErrConversationStoreDisabled
	}
	now := s.now()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Conversation{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.queries.WithTx(tx)
	// A new conversation for the same key replaces the old one in this
	// transaction (A9): a client that lost its id, or one that starts over,
	// never leaves a second live transcript for the key. The key includes the
	// device, so this deletes exactly what Resume would have found - a
	// device-less request never takes a device-bound transcript.
	ids, err := q.AiUniworkConversationIDsByKey(ctx, db.AiUniworkConversationIDsByKeyParams{
		OrganizationID: key.OrganizationID, UserID: key.UserID, Module: key.Module,
		DocumentID: nullableText(key.DocumentID), DeviceID: nullableText(key.DeviceID),
	})
	if err != nil {
		return Conversation{}, err
	}
	if err := deleteConversations(ctx, q, ids); err != nil {
		return Conversation{}, err
	}
	// workspace_id stays NULL: this key carries no workspace (design §9.2), and
	// the document routes derive the tenant from the document itself.
	row, err := q.AiUniworkCreateConversation(ctx, db.AiUniworkCreateConversationParams{
		ID: util.NewID(), OrganizationID: key.OrganizationID,
		UserID: key.UserID, DocumentID: nullableText(key.DocumentID), Module: key.Module,
		DeviceID:      nullableText(key.DeviceID),
		CreatedBy:     key.UserID,
		CreatedByKind: uniworkCreatedByKindHuman,
		CreatedAt:     timestamptz(now), LastUsedAt: timestamptz(now),
		// The earlier of the two TTLs at birth: the idle window.
		ExpiresAt: timestamptz(now.Add(ConversationIdleTTL)),
	})
	if err != nil {
		return Conversation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Conversation{}, err
	}
	return conversationFromRow(row, nil), nil
}

// Append implements ConversationStore.
func (s *ConversationStorePG) Append(ctx context.Context, conversationID string, turns []Turn) error {
	if s.disabled() != nil {
		return ErrConversationStoreDisabled
	}
	if len(turns) == 0 {
		return nil
	}
	now := s.now()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.queries.WithTx(tx)
	organizationID, err := q.AiUniworkTouchConversation(ctx, db.AiUniworkTouchConversationParams{
		Now:            timestamptz(now),
		IdleSecs:       int32(ConversationIdleTTL / time.Second),
		AbsoluteSecs:   int32(ConversationAbsoluteTTL / time.Second),
		ConversationID: conversationID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrConversationExpired
	}
	if err != nil {
		return err
	}
	next, err := q.AiUniworkNextTurnSeq(ctx, conversationID)
	if err != nil {
		return err
	}
	for i, turn := range turns {
		sealed, err := s.sealTurn(turn.Message)
		if err != nil {
			return err
		}
		if _, err := q.AiUniworkInsertTurn(ctx, db.AiUniworkInsertTurnParams{
			ID: util.NewID(), OrganizationID: organizationID, ConversationID: conversationID,
			RunID: turn.RunID, Seq: next + int32(i), Role: turn.Message.Role, Ciphertext: sealed,
			UsageEventID: nullableText(turn.UsageEventID), CreatedAt: timestamptz(now),
		}); err != nil {
			return err
		}
	}
	// Keep at most UniworkMaxUserTurns user turns (A7), then re-densify seq so
	// Rollback's keep = "the turn count before the attempt" stays exact.
	trimmed, err := q.AiUniworkTrimTurns(ctx, db.AiUniworkTrimTurnsParams{
		ConversationID: conversationID, MaxUserTurns: UniworkMaxUserTurns,
	})
	if err != nil {
		return err
	}
	if trimmed > 0 {
		if err := q.AiUniworkRenumberTurns(ctx, conversationID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// Rollback implements ConversationStore.
func (s *ConversationStorePG) Rollback(ctx context.Context, conversationID string, keep int) error {
	return s.queries.AiUniworkRollbackTurns(ctx, db.AiUniworkRollbackTurnsParams{
		ConversationID: conversationID, Seq: int32(keep),
	})
}

// Delete implements ConversationStore.
func (s *ConversationStorePG) Delete(ctx context.Context, conversationID string) error {
	if conversationID == "" {
		return nil
	}
	_, err := s.deleteScoped(ctx, func(*db.Queries) ([]string, error) {
		return []string{conversationID}, nil
	})
	return err
}

// DeleteByDocument implements ConversationStore.
func (s *ConversationStorePG) DeleteByDocument(ctx context.Context, organizationID, documentID string) error {
	if documentID == "" {
		return nil
	}
	_, err := s.deleteScoped(ctx, func(q *db.Queries) ([]string, error) {
		return q.AiUniworkConversationIDsByDocument(ctx, db.AiUniworkConversationIDsByDocumentParams{
			OrganizationID: organizationID, DocumentID: nullableText(documentID),
		})
	})
	return err
}

// DeleteByUserDocument implements ConversationStore.
func (s *ConversationStorePG) DeleteByUserDocument(ctx context.Context, organizationID, userID, documentID string) error {
	_, err := s.deleteScoped(ctx, func(q *db.Queries) ([]string, error) {
		return q.AiUniworkConversationIDsByUserDocument(ctx, db.AiUniworkConversationIDsByUserDocumentParams{
			OrganizationID: organizationID, UserID: userID, DocumentID: nullableText(documentID),
		})
	})
	return err
}

// DeleteByUser implements ConversationStore.
func (s *ConversationStorePG) DeleteByUser(ctx context.Context, organizationID, userID string) error {
	_, err := s.deleteScoped(ctx, func(q *db.Queries) ([]string, error) {
		return q.AiUniworkConversationIDsByUser(ctx, db.AiUniworkConversationIDsByUserParams{
			OrganizationID: organizationID, UserID: userID,
		})
	})
	return err
}

// DeleteByUserAllOrgs removes every conversation of one user in every
// organization that holds one: a sign-out (session.revoked) names only the
// user, and they may have held transcripts in more than one organization.
func (s *ConversationStorePG) DeleteByUserAllOrgs(ctx context.Context, userID string) error {
	if userID == "" {
		return nil
	}
	_, err := s.deleteScoped(ctx, func(q *db.Queries) ([]string, error) {
		return q.AiUniworkConversationIDsByUserAllOrgs(ctx, userID)
	})
	return err
}

// DeleteByOrganization implements ConversationStore; the counted variant below
// is what the TTL worker reports.
func (s *ConversationStorePG) DeleteByOrganization(ctx context.Context, organizationID string) error {
	_, err := s.DeleteOrganizationConversations(ctx, organizationID)
	return err
}

// DeleteOrganizationConversations removes every conversation of one
// organization and reports how many it removed (the kill switch sweep).
func (s *ConversationStorePG) DeleteOrganizationConversations(ctx context.Context, organizationID string) (int64, error) {
	return s.deleteScoped(ctx, func(q *db.Queries) ([]string, error) {
		return q.AiUniworkConversationIDsByOrganization(ctx, organizationID)
	})
}

// Organizations lists the organizations holding at least one transcript: the
// TTL worker asks each whether office_ai_uniwork is still on.
func (s *ConversationStorePG) Organizations(ctx context.Context) ([]string, error) {
	return s.queries.AiUniworkConversationOrganizations(ctx)
}

// LiveConversations counts the conversations that have not expired: the
// uniwork_ai_uniwork_conversations_live gauge.
func (s *ConversationStorePG) LiveConversations(ctx context.Context, now time.Time) (int64, error) {
	return s.queries.AiUniworkCountLiveConversations(ctx, timestamptz(now))
}

// Sweep implements ConversationStore.
func (s *ConversationStorePG) Sweep(ctx context.Context, now time.Time) (int64, error) {
	var total int64
	for i := 0; i < uniworkConversationSweepMaxBatches; i++ {
		n, err := s.sweepBatch(ctx, now)
		total += n
		if err != nil {
			return total, err
		}
		if n < int64(uniworkConversationSweepBatch) {
			return total, nil
		}
		if !sleepCtx(ctx, uniworkConversationSweepPause) {
			return total, ctx.Err()
		}
	}
	return total, nil
}

func (s *ConversationStorePG) sweepBatch(ctx context.Context, now time.Time) (int64, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.queries.WithTx(tx)
	ids, err := q.AiUniworkExpiredConversationIDs(ctx, db.AiUniworkExpiredConversationIDsParams{
		Now: timestamptz(now), Batch: uniworkConversationSweepBatch,
	})
	if err != nil || len(ids) == 0 {
		return 0, err
	}
	if err := deleteConversations(ctx, q, ids); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return int64(len(ids)), nil
}

func (s *ConversationStorePG) disabled() error {
	if s.box == nil {
		return ErrConversationStoreDisabled
	}
	return nil
}

// deleteScoped removes the conversations a loader selects, with their turns,
// in one transaction. No foreign key means the caller deletes both sides (ADR
// 0001); every loader scopes by organization_id, or by an id the caller
// already authorized, which is the `-- tenant:` note on its query.
func (s *ConversationStorePG) deleteScoped(ctx context.Context, load func(*db.Queries) ([]string, error)) (int64, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.queries.WithTx(tx)
	ids, err := load(q)
	if err != nil {
		return 0, err
	}
	if err := deleteConversations(ctx, q, ids); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return int64(len(ids)), nil
}

func deleteConversations(ctx context.Context, q *db.Queries, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	if err := q.AiUniworkDeleteTurnsByConversations(ctx, ids); err != nil {
		return err
	}
	return q.AiUniworkDeleteConversationsByIDs(ctx, ids)
}

func (s *ConversationStorePG) loadTurns(ctx context.Context, conversationID string) ([]Turn, error) {
	rows, err := s.queries.AiUniworkListTurns(ctx, conversationID)
	if err != nil {
		return nil, err
	}
	turns := make([]Turn, 0, len(rows))
	for _, row := range rows {
		message, err := s.openTurn(row.Ciphertext)
		if err != nil {
			return nil, fmt.Errorf("%w: %s", errTurnUnreadable, row.ID)
		}
		turns = append(turns, Turn{
			Seq: row.Seq, RunID: row.RunID, UsageEventID: row.UsageEventID.String,
			CreatedAt: row.CreatedAt.Time, Message: message,
		})
	}
	return turns, nil
}

// turnPayload is what a sealed turn holds: the fields of provider.Message that
// are the transcript (design §9.3). Parts are deliberately not stored - media
// bytes the model already saw are not conversation history.
type turnPayload struct {
	Role       string              `json:"role"`
	Content    string              `json:"content,omitempty"`
	ToolCalls  []provider.ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string              `json:"tool_call_id,omitempty"`
}

func (s *ConversationStorePG) sealTurn(message provider.Message) ([]byte, error) {
	if s.box == nil {
		return nil, ErrConversationStoreDisabled
	}
	raw, err := json.Marshal(turnPayload{
		Role: message.Role, Content: message.Content, ToolCalls: message.ToolCalls, ToolCallID: message.ToolCallID,
	})
	if err != nil {
		return nil, err
	}
	return s.box.Seal(raw)
}

func (s *ConversationStorePG) openTurn(ciphertext []byte) (provider.Message, error) {
	if s.box == nil {
		return provider.Message{}, ErrConversationStoreDisabled
	}
	raw, err := s.box.Open(ciphertext)
	if err != nil {
		return provider.Message{}, err
	}
	var payload turnPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return provider.Message{}, err
	}
	return provider.Message{
		Role: payload.Role, Content: payload.Content, ToolCalls: payload.ToolCalls, ToolCallID: payload.ToolCallID,
	}, nil
}

// ConversationMaintenance is the TTL worker's view of the store: the frozen
// ConversationStore plus the cross-tenant reads and the counted delete the
// worker needs. W-C codes against ConversationStore alone.
type ConversationMaintenance interface {
	ConversationStore
	// Organizations lists the organizations holding at least one transcript.
	Organizations(ctx context.Context) ([]string, error)
	// LiveConversations counts the conversations that have not expired.
	LiveConversations(ctx context.Context, now time.Time) (int64, error)
	// DeleteOrganizationConversations deletes one organization's transcripts
	// (the kill switch turned off) and reports how many.
	DeleteOrganizationConversations(ctx context.Context, organizationID string) (int64, error)
}

// ConversationSweepResult is one pass of the TTL worker.
type ConversationSweepResult struct {
	Expired  int64
	Disabled int64
	Live     int64
}

// ConversationSweepMetrics is the counter surface the sweep needs, so this
// package does not import Prometheus (same shape as outbox.Metrics).
type ConversationSweepMetrics interface {
	IncUniworkConversationsSwept(reason string, conversations int64)
	SetUniworkConversationsLive(n int64)
}

// ConversationTTLWorker is A9's cleanup loop: expired conversations, then the
// organizations whose office_ai_uniwork kill switch is off - a transcript that
// survives a kill switch would be one the capability no longer promises to
// keep. main.go starts it with runCtx and awaits it in the shutdown sequence.
type ConversationTTLWorker struct {
	store   ConversationMaintenance
	off     func(ctx context.Context, organizationID string) (bool, error)
	log     *slog.Logger
	every   time.Duration
	now     func() time.Time
	metrics ConversationSweepMetrics
}

// NewConversationTTLWorker builds the worker. killSwitchOff may be nil (a
// deployment where the flag cannot be read: only the TTL sweep runs); every
// <= 0 uses UniworkConversationSweepInterval; a nil logger uses slog.Default.
func NewConversationTTLWorker(store ConversationMaintenance, killSwitchOff func(ctx context.Context, organizationID string) (bool, error), every time.Duration, log *slog.Logger) *ConversationTTLWorker {
	if every <= 0 {
		every = UniworkConversationSweepInterval
	}
	if log == nil {
		log = slog.Default()
	}
	return &ConversationTTLWorker{store: store, off: killSwitchOff, log: log, every: every, now: time.Now}
}

// SetMetrics attaches the sweep counters.
func (w *ConversationTTLWorker) SetMetrics(m ConversationSweepMetrics) { w.metrics = m }

// SetClock replaces the worker's clock (tests).
func (w *ConversationTTLWorker) SetClock(now func() time.Time) { w.now = now }

// Run sweeps once at start, then every interval, until ctx ends.
func (w *ConversationTTLWorker) Run(ctx context.Context) {
	for {
		result, err := w.SweepOnce(ctx)
		if ctx.Err() != nil {
			return
		}
		switch {
		case err != nil:
			w.log.Warn("uniwork ai conversation sweep", "err", err)
		case result.Expired > 0 || result.Disabled > 0:
			w.log.Info("uniwork ai conversation sweep",
				"expired", result.Expired, "kill_switch", result.Disabled, "live", result.Live)
		}
		if !sleepCtx(ctx, w.every) {
			return
		}
	}
}

// SweepOnce runs one pass and reports what it removed; an error stops the pass
// (the next tick retries).
func (w *ConversationTTLWorker) SweepOnce(ctx context.Context) (ConversationSweepResult, error) {
	now := w.now()
	var result ConversationSweepResult
	expired, err := w.store.Sweep(ctx, now)
	result.Expired = expired
	if err != nil {
		return result, err
	}
	if w.off != nil {
		organizations, err := w.store.Organizations(ctx)
		if err != nil {
			return result, err
		}
		for _, organizationID := range organizations {
			off, err := w.off(ctx, organizationID)
			if err != nil {
				return result, err
			}
			if !off {
				continue
			}
			n, err := w.store.DeleteOrganizationConversations(ctx, organizationID)
			result.Disabled += n
			if err != nil {
				return result, err
			}
		}
	}
	live, err := w.store.LiveConversations(ctx, now)
	result.Live = live
	if err != nil {
		return result, err
	}
	if w.metrics != nil {
		if result.Expired > 0 {
			w.metrics.IncUniworkConversationsSwept(UniworkSweepReasonExpired, result.Expired)
		}
		if result.Disabled > 0 {
			w.metrics.IncUniworkConversationsSwept(UniworkSweepReasonKillSwitch, result.Disabled)
		}
		w.metrics.SetUniworkConversationsLive(result.Live)
	}
	return result, nil
}

// ConversationCleanupStore is what the outbox cleanup consumer drives: the
// frozen ConversationStore plus the one delete that spans organizations,
// because a session.revoked row names only the user (A9 sign-out) and their
// transcripts can live in every organization they held one in.
type ConversationCleanupStore interface {
	ConversationStore
	// DeleteByUserAllOrgs removes every conversation of one user in every
	// organization that holds one.
	DeleteByUserAllOrgs(ctx context.Context, userID string) error
}

// ConversationCleanupConsumer deletes transcripts when what they are bound to
// goes away (A9): the document is deleted, the person loses their membership
// or signs out, or their sessions are revoked. It fans out across the
// conversation and turn tables and, for a sign-out, across organizations, so
// it runs on the slow lane.
type ConversationCleanupConsumer struct {
	store ConversationCleanupStore
}

// NewConversationCleanupConsumer builds the consumer; the store must be the
// deployment's one conversation store (main.go registers it).
func NewConversationCleanupConsumer(store ConversationCleanupStore) *ConversationCleanupConsumer {
	return &ConversationCleanupConsumer{store: store}
}

func (*ConversationCleanupConsumer) Name() string { return "ai_uniwork_conversation_cleanup" }

// Topics is A9's cleanup list: a deleted document, the member events that end
// a person's access to the organization they hold transcripts in, and the
// sign-out that ends their sessions.
func (*ConversationCleanupConsumer) Topics() []string {
	return []string{"document.deleted", "member.removed", "member.left", "member.deactivated", "session.revoked"}
}

// Handle is idempotent by row id: deleting an already deleted conversation is
// a no-op, and a row without the ids it needs is skipped (the TTL still ends
// that transcript).
func (c *ConversationCleanupConsumer) Handle(ctx context.Context, ev outbox.Row) error {
	var payload map[string]string
	if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
		return fmt.Errorf("ai_uniwork_conversation_cleanup: payload of %s: %w", ev.ID, err)
	}
	userID := payload["user_id"]
	if ev.Topic == "session.revoked" {
		// A sign-out names only the user: the transcripts in every
		// organization they held one in go with it.
		if userID == "" {
			return nil
		}
		return c.store.DeleteByUserAllOrgs(ctx, userID)
	}
	organizationID := payload["organization_id"]
	if organizationID == "" {
		// document.deleted carries no organization in its payload (ids only);
		// the outbox row is stamped with it.
		organizationID = ev.OrganizationID.String
	}
	if organizationID == "" {
		return nil
	}
	if ev.Topic == "document.deleted" {
		documentID := payload["document_id"]
		if documentID == "" {
			return nil
		}
		return c.store.DeleteByDocument(ctx, organizationID, documentID)
	}
	if userID == "" {
		return nil
	}
	return c.store.DeleteByUser(ctx, organizationID, userID)
}

func nullableText(v string) pgtype.Text {
	if v == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: v, Valid: true}
}

func timestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

// keyMatchesConversation compares the stored binding with the request's key;
// a NULL column and an empty key field are the same absence.
func keyMatchesConversation(key ConversationKey, row db.AiUniworkConversation) bool {
	return row.UserID == key.UserID && row.Module == key.Module &&
		row.DocumentID.String == key.DocumentID && row.DeviceID.String == key.DeviceID
}

func conversationFromRow(row db.AiUniworkConversation, turns []Turn) Conversation {
	return Conversation{
		ID: row.ID, OrganizationID: row.OrganizationID, UserID: row.UserID,
		DocumentID: row.DocumentID.String, Module: row.Module,
		CreatedAt: row.CreatedAt.Time, LastUsedAt: row.LastUsedAt.Time, ExpiresAt: row.ExpiresAt.Time,
		Turns: turns,
	}
}

// sleepCtx waits d or until ctx ends, reporting whether the wait finished.
func sleepCtx(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

// uniworkCreatedByKindHuman is the ADR 0007 kind of a conversation's creator:
// UniWork AI conversations are opened by the person making the request.
const uniworkCreatedByKindHuman = "human"
