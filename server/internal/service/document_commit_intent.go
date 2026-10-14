package service

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// Logical commit intents (G5-07, UNI-1345; spec G5/G6/G7 §5.2 "Hợp đồng
// resume"). A file version commit that carries an Idempotency-Key is one
// logical intent: the key bound to its payload fingerprint
// (commitFingerprint). Each POST that reaches the commit is an attempt.
//
//   - claim: before the commit transaction, in its own transaction, the
//     attempt inserts the intent row (attempt 1) or, when the previous
//     claim expired without a commit, renews it (attempt n+1, audited as
//     the fence of attempt n). A live claim of another attempt answers
//     idempotency_in_flight; a committed intent replays.
//   - fence: inside the commit transaction the row is locked again and the
//     commit goes on only while the row still names this attempt and its
//     claim is live on the database clock. An attempt whose claim expired -
//     renewed by a newer attempt or not - can never late-commit.
//   - commit: the same transaction marks the intent committed with the
//     version and revision it produced, beside the idempotency ledger answer.
//   - lookup (GET .../versions/commit): reads the row under FOR SHARE, which
//     waits for a commit transaction holding it, so not_committed is only
//     answered once no attempt can still commit: the claim has expired, and
//     any attempt that tries now fails its fence.
//   - sweep: rows past retain_until whose claim is not live are deleted in
//     batches; a lookup of a swept key answers 410 commit_intent_unknown,
//     never not_committed.
//
// The idempotency ledger (idempotency_keys) is untouched: it still replays a
// committed key for as long as it keeps the row (it has no retention of its
// own), so a retry after the intent was swept replays instead of committing
// twice.

// Dev values of the intent windows (contract-p0 §7; G5-D2 fixes the
// production numbers). DOCUMENT_COMMIT_INTENT_CLAIM_TTL and
// DOCUMENT_COMMIT_INTENT_RETENTION override them (config.Config).
const (
	DefaultCommitIntentClaimTTL  = 2 * time.Minute
	DefaultCommitIntentRetention = 7 * 24 * time.Hour
)

// A retry that finds the same payload's claim live waits up to
// commitIntentAwait for it to settle - the duplicate of a slow first request,
// which used to queue behind it on the ledger row - polling every
// commitIntentPoll, then answers idempotency_in_flight.
const (
	commitIntentAwait = 5 * time.Second
	commitIntentPoll  = 50 * time.Millisecond
)

// commitIntentSweepBatch bounds one sweep statement; a pass repeats it until
// a batch comes back short. commitIntentSweepTick is the pass cadence.
const (
	commitIntentSweepBatch = 500
	commitIntentSweepTick  = 10 * time.Minute
)

// Lookup outcomes, the wire vocabulary of CommitIntentSDO.outcome and the
// outcome label of uniwork_office_intent_lookups_total.
const (
	CommitIntentCommitted    = "committed"
	CommitIntentNotCommitted = "not_committed"
	CommitIntentInFlight     = "in_flight"
	CommitIntentUnknown      = "unknown"
)

// officeSyncWriteCapability is the fields.capability value of
// office_capability_off for the sync write flag (the X-03 capability name).
const officeSyncWriteCapability = "sync_write"

// CommitIntentPolicy is the claim TTL and the resume window. A zero field
// keeps the default.
type CommitIntentPolicy struct {
	ClaimTTL  time.Duration
	Retention time.Duration
	// Await bounds how long a retry waits on a live claim of the same
	// payload (commitIntentAwait when zero; tests shorten it).
	Await time.Duration
}

func (p CommitIntentPolicy) claimTTL() time.Duration {
	if p.ClaimTTL <= 0 {
		return DefaultCommitIntentClaimTTL
	}
	return p.ClaimTTL
}

// retention is never shorter than the claim, so a row is never swept while
// its claim could still be live.
func (p CommitIntentPolicy) retention() time.Duration {
	r := p.Retention
	if r <= 0 {
		r = DefaultCommitIntentRetention
	}
	if r < p.claimTTL() {
		r = p.claimTTL()
	}
	return r
}

func (p CommitIntentPolicy) await() time.Duration {
	if p.Await <= 0 {
		return commitIntentAwait
	}
	return p.Await
}

// SetCommitIntentPolicy sets the claim TTL and the resume window.
func (s *DocumentService) SetCommitIntentPolicy(p CommitIntentPolicy) { s.intentPolicy = p }

// DocumentFlags is the flag evaluator the commit reads office_sync_write
// from; *featureflag.Service implements it. Unwired, every flag reads as its
// registry default.
type DocumentFlags interface {
	IsEnabled(ctx context.Context, key string, defaultVal bool) bool
}

// SetFlags wires the flag evaluator.
func (s *DocumentService) SetFlags(f DocumentFlags) { s.flags = f }

// OfficeIntentMetrics are the server-side intent signals (G5-07; G7-07
// alerts on them). metrics.Office implements it; unwired, every call is a nop.
// The 409 at commit is uniwork_document_conflicts_total{kind="file"}, already
// counted by recordDocumentSave.
type OfficeIntentMetrics interface {
	IncOfficeIntentLookup(outcome string)
	IncOfficeIdempotentReplay()
	AddOfficeCommitIntentsSwept(n int)
}

type nopOfficeIntentMetrics struct{}

func (nopOfficeIntentMetrics) IncOfficeIntentLookup(string)    {}
func (nopOfficeIntentMetrics) IncOfficeIdempotentReplay()      {}
func (nopOfficeIntentMetrics) AddOfficeCommitIntentsSwept(int) {}

// SetIntentMetrics wires the intent counters.
func (s *DocumentService) SetIntentMetrics(m OfficeIntentMetrics) {
	if m == nil {
		m = nopOfficeIntentMetrics{}
	}
	s.intentMetrics = m
}

func (s *DocumentService) intentCounters() OfficeIntentMetrics {
	if s.intentMetrics == nil {
		return nopOfficeIntentMetrics{}
	}
	return s.intentMetrics
}

// DocumentIntentWiring is the G5-07 wiring a DocumentService carries: the
// commit intent policy, the office_sync_write evaluator and the intent
// counters.
type DocumentIntentWiring struct {
	Policy        CommitIntentPolicy
	Flags         DocumentFlags
	IntentMetrics OfficeIntentMetrics
}

// IntentWiringForTest reports the wiring this service received, so the
// production-assembly test in cmd/server can pin the instance the routes get.
// Tests only: no server code calls it and it changes no behaviour. A zero
// Policy, a nil Flags or a nil IntentMetrics mean the corresponding setter
// never ran - the shape BE-I4-1 left on the route instance.
func (s *DocumentService) IntentWiringForTest() DocumentIntentWiring {
	return DocumentIntentWiring{Policy: s.intentPolicy, Flags: s.flags, IntentMetrics: s.intentMetrics}
}

func errOfficeCapabilityOff(capability string) error {
	return CodedError{Code: "office_capability_off", Status: http.StatusForbidden, Err: ErrForbidden,
		Msg:    "tính năng này đang tắt cho tổ chức của bạn",
		Fields: map[string]any{"capability": capability}}
}

// errCommitIntentUnknown: the server holds no intent for this key - it was
// swept after its resume window, or never reached this server. It is not
// not_committed: the client keeps reconciling and never mints a new key on it.
func errCommitIntentUnknown() error {
	return CodedError{Code: "commit_intent_unknown", Status: http.StatusGone, Err: ErrNotFound,
		Msg:    "máy chủ không còn thông tin về lần lưu này",
		Fields: map[string]any{"outcome": CommitIntentUnknown}}
}

// syncWriteEnabled reads office_sync_write for the actor in the document's
// organization, with the registry default when no evaluator is wired.
func (s *DocumentService) syncWriteEnabled(ctx context.Context, actor Actor, organizationID string) bool {
	def := true
	if f, ok := featureflags.Lookup(officeSyncWriteFlag); ok {
		def = f.Default
	}
	if s.flags == nil {
		return def
	}
	ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: actor.ID, OrganizationID: organizationID})
	return s.flags.IsEnabled(ctx, officeSyncWriteFlag, def)
}

// commitIntentClaim is the attempt that holds an intent.
type commitIntentClaim struct {
	ID      string
	Attempt int32
}

func seconds(d time.Duration) float64 { return d.Seconds() }

// claimCommitIntent claims the intent of key for this attempt (see the file
// comment). committed reports an intent another attempt committed after the
// caller's ledger peek: the caller replays the ledger answer.
func (s *DocumentService) claimCommitIntent(ctx context.Context, actor Actor, doc db.Document, key, fingerprint string) (claim commitIntentClaim, committed bool, err error) {
	policy := s.intentPolicy
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		// Twice at most: a row swept between the insert and the lock is
		// inserted again on the second turn.
		for range 2 {
			row, err := q.InsertDocumentCommitIntent(ctx, db.InsertDocumentCommitIntentParams{
				ID: util.NewID(), OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
				IdempotencyKey: key, PayloadFingerprint: fingerprint, CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
				ClaimSeconds: seconds(policy.claimTTL()), RetainSeconds: seconds(policy.retention()),
			})
			if err == nil {
				claim = commitIntentClaim{ID: row.ID, Attempt: row.Attempt}
				return nil
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			locked, err := q.LockDocumentCommitIntent(ctx, db.LockDocumentCommitIntentParams{
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, IdempotencyKey: key,
			})
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			if err != nil {
				return err
			}
			intent := locked.DocumentCommitIntent
			if intent.CreatedBy != actor.ID {
				return coded(http.StatusConflict, "idempotency_key_reuse", "idempotency key đã được dùng bởi actor khác")
			}
			if intent.DocumentID != doc.ID || intent.PayloadFingerprint != fingerprint {
				return errIdempotencyPayloadMismatch()
			}
			if intent.State == "committed" {
				committed = true
				return nil
			}
			if locked.Live {
				return ErrIdempotencyInFlight
			}
			renewed, err := q.RenewDocumentCommitIntent(ctx, db.RenewDocumentCommitIntentParams{
				ClaimSeconds: seconds(policy.claimTTL()), RetainSeconds: seconds(policy.retention()),
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, ID: intent.ID, Attempt: intent.Attempt,
			})
			if errors.Is(err, pgx.ErrNoRows) {
				// The row is locked and its claim expired, so only a clock
				// step backwards lands here; refuse rather than guess.
				return ErrIdempotencyInFlight
			}
			if err != nil {
				return err
			}
			// Renewing fences the previous attempt for good: its claim is
			// gone and its fence check can never pass again.
			if err := auditRecorder.Record(ctx, q, audit.Entry{
				OrganizationID: doc.OrganizationID,
				WorkspaceID:    doc.WorkspaceID,
				Actor:          actor,
				Action:         audit.ActionDocumentCommitIntentRenewed,
				ResourceType:   "document",
				ResourceID:     doc.ID,
				Changes: audit.Diff(map[string]any{"attempt": intent.Attempt},
					map[string]any{"attempt": renewed.Attempt, "intent_id": renewed.ID}),
			}); err != nil {
				return err
			}
			claim = commitIntentClaim{ID: renewed.ID, Attempt: renewed.Attempt}
			return nil
		}
		return ErrIdempotencyInFlight
	})
	if err != nil {
		return commitIntentClaim{}, false, NormalizeIdempotencyError(err)
	}
	return claim, committed, nil
}

// claimOrAwaitCommitIntent claims the intent, waiting a bounded time while
// another attempt of the same payload holds a live claim: that attempt
// either commits (the caller then replays) or ends its claim (the caller
// takes the intent over).
func (s *DocumentService) claimOrAwaitCommitIntent(ctx context.Context, actor Actor, doc db.Document, key, fingerprint string) (commitIntentClaim, bool, error) {
	deadline := time.Now().Add(s.intentPolicy.await())
	for {
		claim, committed, err := s.claimCommitIntent(ctx, actor, doc, key, fingerprint)
		if !errors.Is(err, ErrIdempotencyInFlight) || !time.Now().Before(deadline) {
			return claim, committed, err
		}
		t := time.NewTimer(commitIntentPoll)
		select {
		case <-ctx.Done():
			t.Stop()
			return commitIntentClaim{}, false, err
		case <-t.C:
		}
	}
}

// fenceCommitIntent is the commit transaction's proof that this attempt may
// still commit: the row, locked on q, names this attempt and its claim is
// live on the database clock. It holds the lock until the transaction ends,
// so neither a renewal nor a lookup can slip in before the commit lands.
func fenceCommitIntent(ctx context.Context, q *db.Queries, doc db.Document, key string, claim commitIntentClaim) error {
	locked, err := q.LockDocumentCommitIntent(ctx, db.LockDocumentCommitIntentParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, IdempotencyKey: key,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return NormalizeIdempotencyError(ErrIdempotencyInFlight)
	}
	if err != nil {
		return err
	}
	intent := locked.DocumentCommitIntent
	if intent.ID != claim.ID || intent.Attempt != claim.Attempt || intent.State != "claimed" || !locked.Live {
		return NormalizeIdempotencyError(ErrIdempotencyInFlight)
	}
	return nil
}

// markCommitIntentCommitted records the version this attempt committed, in
// the commit transaction.
func (s *DocumentService) markCommitIntentCommitted(ctx context.Context, q *db.Queries, doc db.Document, claim commitIntentClaim, res DocumentFileResult) error {
	_, err := q.MarkDocumentCommitIntentCommitted(ctx, db.MarkDocumentCommitIntentCommittedParams{
		VersionID:      pgtype.Text{String: res.Version.ID, Valid: true},
		Version:        pgtype.Int4{Int32: res.Version.Version, Valid: true},
		Revision:       pgtype.Int8{Int64: res.Document.Revision, Valid: true},
		RetainSeconds:  seconds(s.intentPolicy.retention()),
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, ID: claim.ID, Attempt: claim.Attempt,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return NormalizeIdempotencyError(ErrIdempotencyInFlight)
	}
	return err
}

// releaseCommitIntent ends this attempt's claim after its commit failed, so
// a retry of the key does not wait out the TTL. Best effort: a release that
// does not land leaves the claim to expire, and the query never touches a
// committed row, so a commit whose acknowledgement was lost stays committed.
func (s *DocumentService) releaseCommitIntent(ctx context.Context, doc db.Document, claim commitIntentClaim) {
	_ = s.q.ReleaseDocumentCommitIntent(context.WithoutCancel(ctx), db.ReleaseDocumentCommitIntentParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, ID: claim.ID, Attempt: claim.Attempt,
	})
}

// CommitIntentResult answers GET /documents/{id}/versions/commit. Version and
// Revision are set only when Outcome is committed.
type CommitIntentResult struct {
	Outcome   string
	VersionID string
	Version   int32
	Revision  int64
}

// LookupCommitIntent answers what became of the caller's commit with key. It
// is a read: membership is the document gate (a caller who cannot see the
// document gets not_found), the intent is the caller's own (another member's
// key answers as an unknown one, so it reveals nothing), and it answers
// whatever office_sync_write says.
func (s *DocumentService) LookupCommitIntent(ctx context.Context, actor Actor, documentID, key string) (CommitIntentResult, error) {
	if key == "" {
		return CommitIntentResult{}, Invalid("Idempotency-Key bắt buộc")
	}
	if !validActor(actor) || documentID == "" {
		return CommitIntentResult{}, ErrNotFound
	}
	doc, err := s.q.GetDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return CommitIntentResult{}, ErrNotFound
	}
	if err != nil {
		return CommitIntentResult{}, err
	}
	access, err := s.effectiveLevel(ctx, s.q, actor, doc)
	if err != nil {
		return CommitIntentResult{}, err
	}
	if access.Level == DocumentLevelNone {
		return CommitIntentResult{}, ErrNotFound
	}
	res, err := s.lookupCommitIntent(ctx, actor, doc, key)
	if err != nil {
		var ce CodedError
		if errors.As(err, &ce) && ce.Code == "commit_intent_unknown" {
			s.intentCounters().IncOfficeIntentLookup(CommitIntentUnknown)
		}
		return CommitIntentResult{}, err
	}
	s.intentCounters().IncOfficeIntentLookup(res.Outcome)
	return res, nil
}

func (s *DocumentService) lookupCommitIntent(ctx context.Context, actor Actor, doc db.Document, key string) (CommitIntentResult, error) {
	row, err := s.q.ShareDocumentCommitIntent(ctx, db.ShareDocumentCommitIntentParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, IdempotencyKey: key,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return CommitIntentResult{}, errCommitIntentUnknown()
	}
	if err != nil {
		return CommitIntentResult{}, err
	}
	intent := row.DocumentCommitIntent
	if intent.DocumentID != doc.ID || intent.CreatedBy != actor.ID {
		return CommitIntentResult{}, errCommitIntentUnknown()
	}
	switch {
	case intent.State == "committed":
		return CommitIntentResult{Outcome: CommitIntentCommitted, VersionID: intent.VersionID.String,
			Version: intent.Version.Int32, Revision: intent.Revision.Int64}, nil
	case row.Live:
		return CommitIntentResult{Outcome: CommitIntentInFlight}, nil
	default:
		return CommitIntentResult{Outcome: CommitIntentNotCommitted}, nil
	}
}

// SweepCommitIntents deletes intents past their resume window, in batches,
// until a batch comes back short or ctx ends. It is retention of a ledger, not
// a business change, so it writes no audit row (like EventRetention).
func (s *DocumentService) SweepCommitIntents(ctx context.Context) (int, error) {
	total := 0
	for ctx.Err() == nil {
		n, err := s.q.SweepDocumentCommitIntents(ctx, commitIntentSweepBatch)
		total += int(n)
		if err != nil {
			s.intentCounters().AddOfficeCommitIntentsSwept(total)
			return total, err
		}
		if n < commitIntentSweepBatch {
			break
		}
	}
	s.intentCounters().AddOfficeCommitIntentsSwept(total)
	return total, nil
}
