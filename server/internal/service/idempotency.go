package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// StoredResponse is a previously committed idempotent HTTP response.
type StoredResponse struct {
	Status int
	Body   []byte
}

// ErrIdempotencyInFlight is returned when the same key is claimed but the
// original request has not stored a response yet.
var ErrIdempotencyInFlight = errors.New("idempotency_in_flight")

// IdempotencyOptions binds a key to more than its actor (DOC-005 §3.1). The
// zero value is the legacy ledger: the key is bound to (scope, key, actor)
// only and a retry replays whatever the first request stored. Callers that
// set Fingerprint get a payload check: the same key with a different
// fingerprint - or a row that has no fingerprint at all, which means
// "unknown", never "matches" - is idempotency_payload_mismatch.
type IdempotencyOptions struct {
	// Fingerprint is the versioned hash of the canonical payload
	// (IdempotencyFingerprint). Empty keeps the legacy behaviour.
	Fingerprint string
	// RequireFingerprint makes an empty Fingerprint a caller bug instead of
	// a silent fallback to the legacy ledger. Documents sets it.
	RequireFingerprint bool
}

// errIdempotencyFingerprintRequired is a caller bug: a scope that must bind
// its payload asked without one. It has no HTTP mapping on purpose.
var errIdempotencyFingerprintRequired = errors.New("idempotency: this scope requires a payload fingerprint")

// errIdempotencyPayloadMismatch is the one name for "same key, different
// payload" (C-01 §14.5, DOC-005 §4). The engine contract's
// payload_fingerprint_mismatch maps onto it at the Documents boundary.
func errIdempotencyPayloadMismatch() error {
	return CodedError{
		Code:   "idempotency_payload_mismatch",
		Status: http.StatusConflict,
		Msg:    "idempotency key đã được dùng cho một nội dung khác",
		Err:    ErrConflict,
	}
}

// IdempotencyFingerprint hashes a canonical payload into the versioned form
// the ledger stores ("v1:" + hex sha256). parts are joined with a separator
// that cannot occur inside them after quoting, so ("a","bc") and ("ab","c")
// never collide.
func IdempotencyFingerprint(parts ...string) string {
	h := sha256.New()
	for _, p := range parts {
		_, _ = h.Write([]byte(strconv.Quote(p)))
		_, _ = h.Write([]byte{0})
	}
	return "v1:" + hex.EncodeToString(h.Sum(nil))
}

// BeginIdempotent claims (organization, workspace, scope, key) for actorID.
// A completed prior response is returned as replay (commit is a no-op).
// Otherwise commit must store the status and body after the command succeeds.
func BeginIdempotent(
	ctx context.Context,
	q *db.Queries,
	organizationID, workspaceID, scope, key, actorID string,
	opts IdempotencyOptions,
) (replay *StoredResponse, commit func(status int, body []byte) error, err error) {
	if key == "" {
		return nil, func(int, []byte) error { return nil }, nil
	}
	if opts.RequireFingerprint && opts.Fingerprint == "" {
		return nil, nil, errIdempotencyFingerprintRequired
	}

	existing, err := q.GetIdempotencyKey(ctx, db.GetIdempotencyKeyParams{
		OrganizationID: organizationID,
		WorkspaceID:    workspaceID,
		Scope:          scope,
		Key:            key,
	})
	if err == nil {
		return replayOrInFlight(existing, actorID, opts)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, err
	}

	_, err = q.InsertIdempotencyKey(ctx, db.InsertIdempotencyKeyParams{
		ID:                 util.NewID(),
		OrganizationID:     organizationID,
		WorkspaceID:        workspaceID,
		Scope:              scope,
		Key:                key,
		ActorID:            actorID,
		PayloadFingerprint: pgtype.Text{String: opts.Fingerprint, Valid: opts.Fingerprint != ""},
	})
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, err
		}
		// Lost the race: another request inserted first.
		existing, err = q.GetIdempotencyKey(ctx, db.GetIdempotencyKeyParams{
			OrganizationID: organizationID,
			WorkspaceID:    workspaceID,
			Scope:          scope,
			Key:            key,
		})
		if err != nil {
			return nil, nil, err
		}
		return replayOrInFlight(existing, actorID, opts)
	}

	commit = func(status int, body []byte) error {
		return q.CompleteIdempotencyKey(ctx, db.CompleteIdempotencyKeyParams{
			ResponseStatus: pgtype.Int4{Int32: int32(status), Valid: true},
			ResponseBody:   body,
			OrganizationID: organizationID,
			WorkspaceID:    workspaceID,
			Scope:          scope,
			Key:            key,
		})
	}
	return nil, commit, nil
}

// PeekIdempotent answers what BeginIdempotent would for an existing row -
// replay, reuse, mismatch or in flight - without claiming the key, so a
// caller can honour DOC-005's order (idempotency before the permission
// re-check) before it opens its own transaction. (nil, nil) means the key is
// unused; the caller must still claim it with BeginIdempotent inside its
// transaction, which settles the race.
func PeekIdempotent(
	ctx context.Context,
	q *db.Queries,
	organizationID, workspaceID, scope, key, actorID string,
	opts IdempotencyOptions,
) (*StoredResponse, error) {
	if key == "" {
		return nil, nil
	}
	if opts.RequireFingerprint && opts.Fingerprint == "" {
		return nil, errIdempotencyFingerprintRequired
	}
	existing, err := q.GetIdempotencyKey(ctx, db.GetIdempotencyKeyParams{
		OrganizationID: organizationID,
		WorkspaceID:    workspaceID,
		Scope:          scope,
		Key:            key,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	replay, _, err := replayOrInFlight(existing, actorID, opts)
	return replay, err
}

func replayOrInFlight(row db.IdempotencyKey, actorID string, opts IdempotencyOptions) (*StoredResponse, func(status int, body []byte) error, error) {
	if row.ActorID != actorID {
		return nil, nil, coded(http.StatusConflict, "idempotency_key_reuse", "idempotency key đã được dùng bởi actor khác")
	}
	// A bound caller never replays a row it cannot prove is the same
	// payload: NULL is "unknown" (rows from before migration 9991790519637301 or from a
	// legacy caller), not "matches".
	if opts.Fingerprint != "" && (!row.PayloadFingerprint.Valid || row.PayloadFingerprint.String != opts.Fingerprint) {
		return nil, nil, errIdempotencyPayloadMismatch()
	}
	if !row.ResponseStatus.Valid {
		return nil, nil, ErrIdempotencyInFlight
	}
	noop := func(int, []byte) error { return nil }
	return &StoredResponse{Status: int(row.ResponseStatus.Int32), Body: row.ResponseBody}, noop, nil
}

// CheckTaskRevision refuses a stale optimistic update. got is the revision the
// client sent; want is the server's current revision.
func CheckTaskRevision(got, want int64) error {
	if got == want {
		return nil
	}
	return CodedError{
		Code:   "revision_conflict",
		Status: http.StatusUnprocessableEntity,
		Msg:    "task đã được người khác thay đổi; tải lại rồi thử lại",
		Err:    ErrConflict,
		Fields: map[string]any{"got": got, "want": want},
	}
}
