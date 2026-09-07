package service

import (
	"context"
	"errors"
	"net/http"

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

// BeginIdempotent claims (organization, workspace, scope, key) for actorID.
// A completed prior response is returned as replay (commit is a no-op).
// Otherwise commit must store the status and body after the command succeeds.
func BeginIdempotent(
	ctx context.Context,
	q *db.Queries,
	organizationID, workspaceID, scope, key, actorID string,
) (replay *StoredResponse, commit func(status int, body []byte) error, err error) {
	if key == "" {
		return nil, func(int, []byte) error { return nil }, nil
	}

	existing, err := q.GetIdempotencyKey(ctx, db.GetIdempotencyKeyParams{
		OrganizationID: organizationID,
		WorkspaceID:    workspaceID,
		Scope:          scope,
		Key:            key,
	})
	if err == nil {
		return replayOrInFlight(existing, actorID)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, err
	}

	_, err = q.InsertIdempotencyKey(ctx, db.InsertIdempotencyKeyParams{
		ID:             util.NewID(),
		OrganizationID: organizationID,
		WorkspaceID:    workspaceID,
		Scope:          scope,
		Key:            key,
		ActorID:        actorID,
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
		return replayOrInFlight(existing, actorID)
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

func replayOrInFlight(row db.IdempotencyKey, actorID string) (*StoredResponse, func(status int, body []byte) error, error) {
	if row.ActorID != actorID {
		return nil, nil, coded(http.StatusConflict, "idempotency_key_reuse", "idempotency key đã được dùng bởi actor khác")
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
